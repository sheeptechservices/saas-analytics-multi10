// Leitura da planilha de importação de leads (/api/sdr/leads/import).
//
// Substitui o pacote `xlsx` (SheetJS), que tem duas falhas de alta severidade
// sem correção publicada (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9). A leitura
// passa a usar `exceljs`, que já era dependência para gerar o modelo.
//
// Contrato mantido: a função devolve o MESMO array de objetos que
// `XLSX.utils.sheet_to_json(ws, { defval: '' })` devolvia — mesmas chaves
// (cabeçalho da 1ª linha, `__EMPTY` para coluna sem cabeçalho, sufixo `_1`
// para cabeçalho repetido), mesmos tipos primitivos (número continua número,
// data continua o serial do Excel), mesma regra de linha vazia (linha só com
// formatação é descartada) e `''` para célula ausente. O ETL de
// lib/sdr/leads-etl.ts não muda.
//
// Formatos aceitos: .xlsx e .csv. O .xls (formato binário antigo) saiu junto
// com o SheetJS — o exceljs não lê esse formato.
//
// Os limites são checados na ordem barata → cara: tamanho → extensão →
// assinatura do arquivo → bytes REALMENTE descomprimidos do zip → colunas →
// linhas. Linha e coluna cortam durante a leitura, antes de montar os objetos
// de linha — um arquivo estreito de 5 MB não pode virar 250 mil colunas na
// memória do servidor.
//
// Por que `xlsx.load()` e não o `ExcelJS.stream.xlsx.WorkbookReader`: o leitor
// em streaming do exceljs quebra em arquivos gerados pelo próprio exceljs
// (`xl/workbook.xml` é a última entrada do zip e ele tenta resolver o nome da
// aba antes de ler essa entrada) — ou seja, no NOSSO modelo de planilha — e,
// quando `xl/sharedStrings.xml` vem depois de `xl/worksheets/sheet1.xml` (o
// que o Excel faz), ele despeja a planilha inteira num arquivo temporário
// antes de entregar a primeira linha. Não sobra streaming nenhum.

import { inflateRawSync } from 'node:zlib'
import ExcelJS from 'exceljs'

export const MAX_FILE_BYTES = 5 * 1024 * 1024   // 5 MB
export const MAX_ROWS       = 1000

/**
 * Teto de colunas. A planilha de leads tem 5 colunas; 256 já é folga enorme.
 * Sem esse teto, um arquivo minúsculo (meio MB de vírgulas) vira centenas de
 * milhares de colunas × MAX_ROWS chaves de objeto e derruba o processo.
 */
export const MAX_COLS = 256

/** Folga do envelope multipart sobre o tamanho do arquivo (boundary + headers). */
export const MULTIPART_SLACK_BYTES = 64 * 1024

/**
 * Orçamento de bytes descomprimidos do .xlsx. O máximo que uma planilha
 * ACEITÁVEL produz é MAX_ROWS × MAX_COLS = 256 mil células (~12 MB de
 * sheet1.xml + sharedStrings de tamanho parecido): 32 MB cobre isso com folga
 * e é o teto do que o exceljs pode receber para montar o modelo dele.
 */
export const MAX_UNZIPPED_BYTES = 32 * 1024 * 1024  // 32 MB

/** Mensagens devolvidas ao usuário — sem stack trace e sem detalhe interno. */
export const IMPORT_ERRORS = {
  xlsLegado:     'Formato .xls não é mais aceito. Abra a planilha no Excel e salve como .xlsx (ou exporte como .csv).',
  extensao:      'Arquivo deve ser .xlsx ou .csv',
  tamanho:       'Arquivo muito grande (máximo 5 MB)',
  corrompido:    'Não foi possível ler a planilha. Verifique se o arquivo é um .xlsx válido e tente de novo.',
  csvInvalido:   'Não foi possível ler o .csv. Salve o arquivo como CSV (UTF-8) e tente de novo.',
  semAbas:       'Arquivo sem abas',
  semLinhas:     'Arquivo sem linhas de dados',
  muitasLinhas:  `Máximo de ${MAX_ROWS} linhas por importação`,
  muitasColunas: `Máximo de ${MAX_COLS} colunas por importação — remova as colunas vazias à direita e tente de novo.`,
} as const

export type ImportKind = 'xlsx' | 'csv'

export type ParseOk   = { ok: true;  rows: Record<string, unknown>[]; rowsScanned: number }
export type ParseFail = { ok: false; error: string; rowsScanned: number }
export type ParseResult = ParseOk | ParseFail

const fail = (error: string, rowsScanned = 0): ParseFail => ({ ok: false, error, rowsScanned })

// ─── Portões baratos ──────────────────────────────────────────────────────────

/**
 * Classifica pela extensão. `'xls'` é devolvido à parte para dar a mensagem
 * específica ("salve como .xlsx") em vez do genérico.
 */
export function detectKind(fileName: string): ImportKind | 'xls' | null {
  const m = /\.([a-z0-9]+)$/i.exec(fileName.trim())
  if (!m) return null
  switch (m[1].toLowerCase()) {
    case 'xlsx': return 'xlsx'
    case 'csv':  return 'csv'
    case 'xls':  return 'xls'
    default:     return null
  }
}

/** Mensagem do portão de extensão, ou `null` quando a extensão passa. */
export function extensionError(fileName: string): string | null {
  const kind = detectKind(fileName)
  if (kind === 'xls') return IMPORT_ERRORS.xlsLegado
  if (kind === null)  return IMPORT_ERRORS.extensao
  return null
}

export function exceedsSize(bytes: number, max = MAX_FILE_BYTES): boolean {
  return Number.isFinite(bytes) && bytes > max
}

/** `Content-Length` do POST inteiro — o envelope multipart soma alguns KB. */
export function exceedsContentLength(contentLength: string | null, max = MAX_FILE_BYTES): boolean {
  if (!contentLength) return false
  const n = Number(contentLength)
  return Number.isFinite(n) && n > max + MULTIPART_SLACK_BYTES
}

/** Assinatura de arquivo zip — todo .xlsx é um zip. */
export function looksLikeZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04
}

export type InflateCheck =
  | { ok: true;  bytes: number }
  | { ok: false; reason: 'corrompido' | 'grande'; bytes: number }

/**
 * Mede quantos bytes o zip REALMENTE produz ao ser descomprimido, abortando
 * assim que passa do orçamento.
 *
 * O campo "tamanho descomprimido" do diretório central não serve para isso: ele
 * é escrito por quem montou o arquivo e o jszip (que o exceljs usa) nunca o
 * confere contra o stream de verdade — declarar 100 bytes e entregar 200 MB
 * passa direto. Por isso aqui o diretório central é usado só para localizar as
 * entradas, e cada uma é inflada com `maxOutputLength` igual ao que sobrou do
 * orçamento: o zlib estoura ANTES de alocar além disso, então nem o tempo nem a
 * memória dependem do que o arquivo declara.
 *
 * O tamanho comprimido declarado também é ignorado: infla-se do início dos
 * dados até o fim do buffer, porque o zlib para sozinho no fim do stream.
 */
export function checkInflatedSize(data: Uint8Array, budget = MAX_UNZIPPED_BYTES): InflateCheck {
  const corrupt = (bytes = 0): InflateCheck => ({ ok: false, reason: 'corrompido', bytes })
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  // End of Central Directory: assinatura PK\x05\x06, no máximo 64 KB do fim.
  const floor = Math.max(0, data.length - 66_000)
  let eocd = -1
  for (let i = data.length - 22; i >= floor; i--) {
    if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x05 && data[i + 3] === 0x06) { eocd = i; break }
  }
  if (eocd < 0) return corrupt()

  const entries = view.getUint16(eocd + 10, true)
  let offset    = view.getUint32(eocd + 16, true)
  if (offset === 0xffffffff) return corrupt()  // ZIP64 — fora do tamanho que aceitamos

  let total = 0
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > data.length) return corrupt(total)
    if (!(data[offset] === 0x50 && data[offset + 1] === 0x4b && data[offset + 2] === 0x01 && data[offset + 3] === 0x02)) return corrupt(total)

    const method   = view.getUint16(offset + 10, true)
    const compSize = view.getUint32(offset + 20, true)
    const nameLen  = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const cmtLen   = view.getUint16(offset + 32, true)
    const localHdr = view.getUint32(offset + 42, true)
    if (localHdr === 0xffffffff || compSize === 0xffffffff) return corrupt(total)
    if (localHdr + 30 > data.length) return corrupt(total)
    if (!(data[localHdr] === 0x50 && data[localHdr + 1] === 0x4b && data[localHdr + 2] === 0x03 && data[localHdr + 3] === 0x04)) return corrupt(total)

    const dataStart = localHdr + 30 + view.getUint16(localHdr + 26, true) + view.getUint16(localHdr + 28, true)
    if (dataStart > data.length) return corrupt(total)

    const remaining = budget - total
    if (remaining <= 0) return { ok: false, reason: 'grande', bytes: total }

    if (method === 0) {
      // Guardado sem compressão: o tamanho é o que está no arquivo mesmo.
      total += Math.min(compSize, data.length - dataStart)
    } else if (method === 8) {
      try {
        const slice = Buffer.from(data.buffer, data.byteOffset + dataStart, data.length - dataStart)
        total += inflateRawSync(slice, { maxOutputLength: remaining }).length
      } catch (err) {
        // ERR_BUFFER_TOO_LARGE = passou do orçamento; qualquer outro = arquivo quebrado.
        const code = (err as { code?: string }).code
        return code === 'ERR_BUFFER_TOO_LARGE'
          ? { ok: false, reason: 'grande', bytes: budget }
          : corrupt(total)
      }
    } else {
      return corrupt(total)  // método que o jszip também não leria
    }

    if (total > budget) return { ok: false, reason: 'grande', bytes: total }
    offset += 46 + nameLen + extraLen + cmtLen
  }
  return { ok: true, bytes: total }
}

// ─── Normalização de célula (exceljs → primitivos do SheetJS) ─────────────────

type NormCell = {
  /** Valor no formato que `sheet_to_json` produzia (`''` quando a célula não existe). */
  value: string | number | boolean | null
  /** Célula existe e tem valor — é isso que faz a linha não ser "vazia". */
  present: boolean
  /** Texto para montar o nome da coluna; `null` quando a célula não existe. */
  text: string | null
}

const ABSENT: NormCell = { value: '', present: false, text: null }

/** Serial do Excel a partir de um Date — inverso exato do que o exceljs usa na leitura. */
function dateToSerial(d: Date, date1904: boolean): number {
  return 25569 + d.getTime() / 86_400_000 - (date1904 ? 1462 : 0)
}

function flattenRichText(parts: { text?: string }[]): string {
  return parts.map(p => p?.text ?? '').join('')
}

/**
 * Converte o valor do exceljs para o primitivo que o `xlsx` devolvia.
 * Objetos (rich text, fórmula, hyperlink, erro) viram o mesmo escalar de antes.
 */
function normalizeValue(value: unknown, date1904: boolean): NormCell {
  if (value === null || value === undefined) return ABSENT

  if (value instanceof Date) {
    const serial = dateToSerial(value, date1904)
    return { value: serial, present: true, text: String(serial) }
  }

  switch (typeof value) {
    case 'string':  return { value, present: true, text: value }
    case 'number':  return { value, present: true, text: String(value) }
    case 'boolean': return { value, present: true, text: value ? 'TRUE' : 'FALSE' }
  }

  const obj = value as Record<string, unknown>

  // Rich text → texto puro concatenado (era o que o SheetJS guardava).
  if (Array.isArray(obj.richText)) {
    const text = flattenRichText(obj.richText as { text?: string }[])
    return { value: text, present: true, text }
  }

  // Hyperlink → só o texto visível; o link ficava fora da célula no SheetJS.
  if ('hyperlink' in obj) return normalizeValue(obj.text ?? '', date1904)

  // Fórmula → resultado em cache. Sem cache, o SheetJS não via valor nenhum.
  if ('formula' in obj || 'sharedFormula' in obj) {
    if (obj.result === undefined || obj.result === null) return ABSENT
    return normalizeValue(obj.result, date1904)
  }

  // Erro (#DIV/0! etc.) não contava como valor para o SheetJS; só #NULL! virava null.
  if ('error' in obj) {
    const code = String(obj.error)
    return { value: code === '#NULL!' ? null : '', present: false, text: code }
  }

  const text = String(value)
  return { value: text, present: true, text }
}

function normalizeCell(cell: ExcelJS.Cell, date1904: boolean): NormCell {
  // Célula "escrava" de merge: no XML ela não existe, então o SheetJS não a via.
  if (cell.type === ExcelJS.ValueType.Merge) return ABSENT
  return normalizeValue(cell.value, date1904)
}

// ─── Cabeçalhos ───────────────────────────────────────────────────────────────

/**
 * Monta os nomes das colunas como o `sheet_to_json`: coluna sem célula vira
 * `__EMPTY` e nome repetido ganha sufixo `_1`, `_2`, …
 */
function buildHeaderNames(texts: (string | null)[]): string[] {
  const seen = new Map<string, number>()
  return texts.map(t => {
    const base = t ?? '__EMPTY'
    const used = seen.get(base) ?? 0
    if (!used) { seen.set(base, 1); return base }
    let counter = used
    let name = `${base}_${counter++}`
    while (seen.has(name)) name = `${base}_${counter++}`
    seen.set(base, counter)
    seen.set(name, 1)
    return name
  })
}

// ─── .xlsx ────────────────────────────────────────────────────────────────────

async function parseXlsx(data: Uint8Array, maxRows: number, maxCols: number): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook()
  try {
    // O exceljs declara `interface Buffer extends ArrayBuffer` (index.d.ts:1), e
    // essa declaração global faz nenhum Buffer do Node servir ao tipo de
    // `load()`. Em runtime ele aceita Buffer/Uint8Array sem problema.
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])
  } catch {
    return fail(IMPORT_ERRORS.corrompido)
  }

  const ws = wb.worksheets[0]
  if (!ws) return fail(IMPORT_ERRORS.semAbas)

  const date1904 = Boolean((wb.properties as { date1904?: boolean } | undefined)?.date1904)

  const dim    = ws.dimensions
  const top    = dim?.top    ?? 1
  const left   = dim?.left   ?? 1
  const bottom = dim?.bottom ?? ws.rowCount
  const right  = dim?.right  ?? ws.columnCount
  if (!bottom || !right || bottom < top || right < left) return fail(IMPORT_ERRORS.semLinhas)

  // Colunas ANTES de montar cabeçalho e linhas: cada coluna vira uma chave em
  // cada objeto de linha, então é aqui que uma planilha larga explodiria.
  if (right - left + 1 > maxCols) return fail(IMPORT_ERRORS.muitasColunas)

  const headerRow = ws.getRow(top)
  const texts: (string | null)[] = []
  for (let c = left; c <= right; c++) texts.push(normalizeCell(headerRow.getCell(c), date1904).text)
  const header = buildHeaderNames(texts)
  if (header.length > maxCols) return fail(IMPORT_ERRORS.muitasColunas)

  const rows: Record<string, unknown>[] = []
  let scanned = 0

  for (let r = top + 1; r <= bottom; r++) {
    scanned++
    const excelRow = ws.getRow(r)
    const row: Record<string, unknown> = {}
    let empty = true
    for (let c = left; c <= right; c++) {
      const cell = normalizeCell(excelRow.getCell(c), date1904)
      row[header[c - left]] = cell.value
      if (cell.present) empty = false
    }
    if (empty) continue                       // linha só com formatação: o SheetJS também descartava
    if (rows.length >= maxRows) return fail(IMPORT_ERRORS.muitasLinhas, scanned)
    rows.push(row)
  }

  if (rows.length === 0) return fail(IMPORT_ERRORS.semLinhas, scanned)
  return { ok: true, rows, rowsScanned: scanned }
}

// ─── .csv ─────────────────────────────────────────────────────────────────────

/** Decodifica como UTF-8; cai para windows-1252 (o "CSV" que o Excel pt-BR salva). */
export function decodeCsv(data: Uint8Array): string | null {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    try { text = new TextDecoder('windows-1252').decode(data) } catch { return null }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  // NUL escrito via fromCharCode de propósito: um U+0000 cru no fonte faz o
  // git tratar o arquivo como binário e o diff sumir.
  if (text.includes(String.fromCharCode(0))) return null   // binário renomeado para .csv
  return text
}

/** Separador do arquivo: o mais frequente na 1ª linha, fora de aspas. */
function detectDelimiter(text: string): string {
  const end  = (() => { const i = text.search(/\r|\n/); return i < 0 ? text.length : i })()
  const head = text.slice(0, end)
  let inQuotes = false
  const count: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  for (let i = 0; i < head.length; i++) {
    const ch = head[i]
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (!inQuotes && ch in count) count[ch]++
  }
  if (count[';'] > count[','] && count[';'] >= count['\t']) return ';'
  if (count['\t'] > count[','] && count['\t'] > count[';']) return '\t'
  return ','
}

/** Sinal interno: o arquivo passou de `maxCols` colunas no meio da varredura. */
class ColunasDemais extends Error {}

/**
 * Percorre o CSV campo a campo (RFC 4180) sem montar o arquivo inteiro na
 * memória. O teto de colunas é aplicado DENTRO da varredura: meio MB de
 * vírgulas numa linha só pararia de pé se o registro pudesse crescer sem limite.
 */
function* csvRecords(text: string, delim: string, maxCols: number): Generator<string[]> {
  let field = ''
  let record: string[] = []
  let inQuotes = false
  let started = false
  const push = (v: string) => {
    if (record.length >= maxCols) throw new ColunasDemais()
    record.push(v)
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') { inQuotes = true; started = true; continue }
    if (ch === delim) { push(field); field = ''; started = true; continue }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      push(field)
      yield record
      record = []; field = ''; started = false
      continue
    }
    field += ch
    started = true
  }
  if (started || field !== '' || record.length > 0) { push(field); yield record }
}

function parseCsv(data: Uint8Array, maxRows: number, maxCols: number): ParseResult {
  const text = decodeCsv(data)
  if (text === null) return fail(IMPORT_ERRORS.csvInvalido)
  if (text.trim() === '') return fail(IMPORT_ERRORS.semLinhas)

  const rows: Record<string, unknown>[] = []
  let scanned = 0

  try {
    const records = csvRecords(text, detectDelimiter(text), maxCols)

    const first = records.next()
    if (first.done) return fail(IMPORT_ERRORS.semLinhas)
    const header = buildHeaderNames(first.value)
    if (header.length > maxCols) return fail(IMPORT_ERRORS.muitasColunas)

    for (const record of records) {
      scanned++
      if (record.every(v => v === '')) continue
      if (rows.length >= maxRows) return fail(IMPORT_ERRORS.muitasLinhas, scanned)
      const row: Record<string, unknown> = {}
      for (let c = 0; c < header.length; c++) row[header[c]] = record[c] ?? ''
      rows.push(row)
    }
  } catch (err) {
    if (err instanceof ColunasDemais) return fail(IMPORT_ERRORS.muitasColunas, scanned)
    throw err
  }

  if (rows.length === 0) return fail(IMPORT_ERRORS.semLinhas, scanned)
  return { ok: true, rows, rowsScanned: scanned }
}

// ─── Entrada única ────────────────────────────────────────────────────────────

/**
 * Aplica os portões na ordem (tamanho → extensão → assinatura → zip → parse) e
 * devolve as linhas no mesmo formato que o parser antigo produzia.
 */
export async function parseImportFile(
  input: { fileName: string; size?: number; data: Uint8Array },
  opts: { maxRows?: number; maxCols?: number; maxBytes?: number; maxUnzipped?: number } = {},
): Promise<ParseResult> {
  const maxRows  = opts.maxRows  ?? MAX_ROWS
  const maxCols  = opts.maxCols  ?? MAX_COLS
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES

  const size = input.size ?? input.data.length
  if (exceedsSize(size, maxBytes) || exceedsSize(input.data.length, maxBytes)) {
    return fail(IMPORT_ERRORS.tamanho)
  }

  const extErr = extensionError(input.fileName)
  if (extErr) return fail(extErr)

  if (detectKind(input.fileName) === 'csv') return parseCsv(input.data, maxRows, maxCols)

  if (!looksLikeZip(input.data)) return fail(IMPORT_ERRORS.corrompido)

  // Só depois de saber quanto o zip realmente produz é que o exceljs recebe o
  // arquivo — é este portão que limita a memória do `load()`.
  const inflated = checkInflatedSize(input.data, opts.maxUnzipped ?? MAX_UNZIPPED_BYTES)
  if (!inflated.ok) {
    return fail(inflated.reason === 'grande' ? IMPORT_ERRORS.tamanho : IMPORT_ERRORS.corrompido)
  }

  return parseXlsx(input.data, maxRows, maxCols)
}
