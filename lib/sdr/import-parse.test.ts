import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import {
  IMPORT_ERRORS,
  MAX_COLS,
  MAX_FILE_BYTES,
  MAX_ROWS,
  checkInflatedSize,
  detectKind,
  exceedsContentLength,
  extensionError,
  looksLikeZip,
  parseImportFile,
  type ParseResult,
} from '@/lib/sdr/import-parse'
import { mapKey, normalizePhone } from '@/lib/sdr/leads-etl'

// ─── Utilidades ───────────────────────────────────────────────────────────────

/** Monta um .xlsx em memória com exceljs (mesmo caminho que gera o modelo). */
async function xlsxBuffer(build: (ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  build(wb.addWorksheet('Leads'))
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

const csvBuffer = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'))

const parse = (fileName: string, data: Uint8Array, opts?: { maxRows?: number; maxCols?: number; maxBytes?: number }) =>
  parseImportFile({ fileName, data }, opts)

// ─── Portão 1: extensão ───────────────────────────────────────────────────────

test('extensão: .xlsx e .csv passam, o resto não', () => {
  assert.equal(detectKind('leads.xlsx'), 'xlsx')
  assert.equal(detectKind('LEADS.XLSX'), 'xlsx')
  assert.equal(detectKind('leads.csv'), 'csv')
  assert.equal(detectKind('leads.xls'), 'xls')
  assert.equal(detectKind('leads.txt'), null)
  assert.equal(detectKind('leads'), null)
  assert.equal(extensionError('leads.xlsx'), null)
  assert.equal(extensionError('leads.csv'), null)
})

test('.xls é recusado com instrução de salvar como .xlsx', async () => {
  const res = await parse('planilha.xls', csvBuffer('nome,telefone\nAna,11988887777\n'))
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.xlsLegado)
  assert.match(IMPORT_ERRORS.xlsLegado, /\.xlsx/)
  assert.ok(!IMPORT_ERRORS.xlsLegado.includes('Error'), 'mensagem não pode vazar detalhe interno')
})

test('extensão desconhecida é recusada antes de qualquer leitura', async () => {
  const res = await parse('leads.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46]))
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.extensao)
  assert.equal(res.rowsScanned, 0)
})

// ─── Portão 2: tamanho ────────────────────────────────────────────────────────

test('arquivo grande demais é recusado antes do parse', async () => {
  // Conteúdo proposital de lixo: se o parser tentasse ler, daria outro erro.
  const gordo = new Uint8Array(MAX_FILE_BYTES + 1)
  gordo[0] = 0x50; gordo[1] = 0x4b; gordo[2] = 0x03; gordo[3] = 0x04
  const res = await parseImportFile({ fileName: 'leads.xlsx', size: gordo.length, data: gordo })
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.tamanho)
  assert.equal(res.rowsScanned, 0)
})

test('tamanho declarado no multipart também barra (File.size)', async () => {
  const res = await parseImportFile(
    { fileName: 'leads.xlsx', size: MAX_FILE_BYTES + 1, data: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) },
  )
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.tamanho)
})

test('content-length do POST barra com folga para o envelope multipart', () => {
  assert.equal(exceedsContentLength(null), false)
  assert.equal(exceedsContentLength(String(MAX_FILE_BYTES)), false)
  assert.equal(exceedsContentLength(String(MAX_FILE_BYTES + 1024)), false)   // folga do boundary
  assert.equal(exceedsContentLength(String(MAX_FILE_BYTES * 2)), true)
})

// ─── Portão 3: assinatura / arquivo corrompido ───────────────────────────────

test('arquivo que não é zip é recusado com mensagem amigável', async () => {
  assert.equal(looksLikeZip(csvBuffer('nada disso')), false)
  const res = await parse('leads.xlsx', csvBuffer('isto aqui não é um xlsx'))
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.corrompido)
  assert.ok(res.ok === false && !/at |Error:|\.js:/.test(res.error), 'sem stack trace')
})

test('zip truncado (sem diretório central) é recusado sem estourar', async () => {
  const bom = await xlsxBuffer(ws => { ws.addRow(['nome', 'telefone']); ws.addRow(['Ana', '11988887777']) })
  const cortado = bom.slice(0, Math.floor(bom.length / 2))
  assert.equal(looksLikeZip(cortado), true)          // ainda começa com PK\x03\x04
  assert.equal(checkInflatedSize(cortado).ok, false)
  const res = await parse('leads.xlsx', cortado)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.corrompido)
})

test('zip válido: o orçamento mede os bytes realmente inflados', async () => {
  const bom = await xlsxBuffer(ws => { ws.addRow(['nome']); ws.addRow(['Ana']) })
  const res = checkInflatedSize(bom)
  assert.equal(res.ok, true)
  assert.ok(res.bytes > 0)
})

// ─── .xlsx: tipos de célula ───────────────────────────────────────────────────

test('.xlsx: acentos no cabeçalho, célula vazia, telefone numérico, data, rich text e fórmula', async () => {
  const data = await xlsxBuffer(ws => {
    const h = ws.getRow(1)
    h.getCell(1).value = 'Nome'
    h.getCell(2).value = 'Telefone'
    h.getCell(3).value = 'Empresa'
    h.getCell(4).value = 'Observação'
    h.commit()

    ws.addRow(['Ana Silva', '+5511988887777', 'Acme', 'ok'])

    const r3 = ws.getRow(3)
    r3.getCell(1).value = 'Bruno'
    r3.getCell(2).value = 11988887777                       // número, não string
    r3.commit()                                             // colunas 3 e 4 ausentes

    const r4 = ws.getRow(4)
    r4.getCell(1).value = { richText: [{ text: 'Dan' }, { text: 'iel', font: { bold: true } }] }
    r4.getCell(2).value = { formula: 'CONCATENATE("119","88887778")', result: '11988887778' }
    r4.getCell(3).value = { text: 'Site Acme', hyperlink: 'https://acme.example' }
    r4.getCell(4).value = new Date(Date.UTC(2024, 0, 15))   // data → serial do Excel, como no parser antigo
    r4.commit()
  })

  const res = await parse('leads.xlsx', data)
  assert.ok(res.ok)
  assert.deepEqual(res.rows, [
    { Nome: 'Ana Silva', Telefone: '+5511988887777', Empresa: 'Acme', 'Observação': 'ok' },
    { Nome: 'Bruno',     Telefone: 11988887777,      Empresa: '',     'Observação': '' },
    { Nome: 'Daniel',    Telefone: '11988887778',    Empresa: 'Site Acme', 'Observação': 45306 },
  ])
})

test('.xlsx: linha em branco e linha só com formatação são descartadas (como antes)', async () => {
  const data = await xlsxBuffer(ws => {
    ws.addRow(['nome', 'telefone'])
    ws.addRow(['Ana', '11988887777'])
    ws.addRow([])                                           // vazia
    const r4 = ws.getRow(4)                                 // só bordas, igual ao modelo baixado
    r4.getCell(1).border = { top: { style: 'thin' } }
    r4.getCell(2).border = { top: { style: 'thin' } }
    r4.commit()
    ws.addRow(['Bruno', '11977776666'])
  })

  const res = await parse('leads.xlsx', data)
  assert.ok(res.ok)
  assert.equal(res.rows.length, 2)
  assert.deepEqual(res.rows.map(r => r.nome), ['Ana', 'Bruno'])
})

test('.xlsx: coluna sem cabeçalho vira __EMPTY e cabeçalho repetido ganha sufixo', async () => {
  const data = await xlsxBuffer(ws => {
    const h = ws.getRow(1)
    h.getCell(1).value = 'Nome'
    h.getCell(3).value = 'Nome'                             // repetido; coluna 2 sem cabeçalho
    h.commit()
    ws.addRow(['Ana', 'x', 'Silva'])
  })

  const res = await parse('leads.xlsx', data)
  assert.ok(res.ok)
  assert.deepEqual(Object.keys(res.rows[0]), ['Nome', '__EMPTY', 'Nome_1'])
})

test('.xlsx sem linhas de dados é recusado', async () => {
  const data = await xlsxBuffer(ws => { ws.addRow(['nome', 'telefone']) })
  const res = await parse('leads.xlsx', data)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.semLinhas)
})

// ─── Equivalência com o parser antigo (SheetJS) ───────────────────────────────

// O array abaixo é a saída LITERAL de
// `XLSX.utils.sheet_to_json(ws, { defval: '' })` (xlsx@0.18.5, o parser que
// estava na rota) para a planilha montada em `planilhaDeReferencia`. Foi
// capturado rodando os dois parsers lado a lado sobre o MESMO arquivo, antes de
// o pacote `xlsx` sair do projeto. Serve de trava: se a leitura mudar de
// comportamento, este teste quebra.
const SAIDA_DO_PARSER_ANTIGO: Record<string, unknown>[] = [
  { Nome: 'Ana Silva',   Telefone: '+5511988887777', Empresa: 'Acme',      Origem: 'site', Status: 'novo', 'Observação': 'ok', 'Observação_1': 'dup', __EMPTY: '',               'Última compra': 'x' },
  { Nome: 'Bruno Souza', Telefone: 11988887777,      Empresa: '',          Origem: '',     Status: '',     'Observação': '',   'Observação_1': '',    __EMPTY: 'sem cabeçalho', 'Última compra': '' },
  { Nome: 'Carla',       Telefone: '11 3333-4444',   Empresa: '',          Origem: '',     Status: '',     'Observação': '',   'Observação_1': '',    __EMPTY: '',               'Última compra': 45306 },
  { Nome: 'Daniel',      Telefone: '11988887778',    Empresa: 'Site Acme', Origem: true,   Status: '',     'Observação': '',   'Observação_1': '',    __EMPTY: '',               'Última compra': '' },
  { Nome: 'Eva',         Telefone: '5511977776666',  Empresa: 'Zeta',      Origem: '',     Status: '',     'Observação': '',   'Observação_1': '',    __EMPTY: '',               'Última compra': '' },
]

/** Planilha de referência: um caso de cada coisa que o SheetJS tratava. */
const planilhaDeReferencia = () => xlsxBuffer(ws => {
  const h = ws.getRow(1)
  h.getCell(1).value = 'Nome'
  h.getCell(2).value = 'Telefone'
  h.getCell(3).value = 'Empresa'
  h.getCell(4).value = 'Origem'
  h.getCell(5).value = 'Status'
  h.getCell(6).value = 'Observação'
  h.getCell(7).value = 'Observação'        // repetido → Observação_1
  h.getCell(9).value = 'Última compra'     // coluna 8 fica sem cabeçalho → __EMPTY
  h.commit()

  ws.addRow(['Ana Silva', '+5511988887777', 'Acme', 'site', 'novo', 'ok', 'dup', '', 'x'])

  const r3 = ws.getRow(3)
  r3.getCell(1).value = 'Bruno Souza'
  r3.getCell(2).value = 11988887777        // telefone numérico
  r3.getCell(5).value = ''                 // string vazia explícita
  r3.getCell(8).value = 'sem cabeçalho'
  r3.commit()

  const r4 = ws.getRow(4)
  r4.getCell(1).value = 'Carla'
  r4.getCell(2).value = '11 3333-4444'
  r4.getCell(9).value = new Date(Date.UTC(2024, 0, 15))   // data → serial 45306
  r4.commit()

  const r5 = ws.getRow(5)
  r5.getCell(1).value = { richText: [{ text: 'Dan' }, { text: 'iel', font: { bold: true } }] }
  r5.getCell(2).value = { formula: 'CONCATENATE("119","88887778")', result: '11988887778' }
  r5.getCell(3).value = { text: 'Site Acme', hyperlink: 'https://acme.example' }
  r5.getCell(4).value = true
  r5.commit()

  ws.addRow([])                            // linha vazia

  const r7 = ws.getRow(7)                  // linha só com bordas
  for (let c = 1; c <= 9; c++) r7.getCell(c).border = { top: { style: 'thin' } }
  r7.commit()

  ws.addRow(['Eva', '5511977776666', 'Zeta', '', '', '', '', '', ''])
})

test('a saída é idêntica à do parser antigo (xlsx@0.18.5) na planilha de referência', async () => {
  const res = await parse('leads.xlsx', await planilhaDeReferencia())
  assert.ok(res.ok)
  assert.deepStrictEqual(res.rows, SAIDA_DO_PARSER_ANTIGO)
  assert.equal(JSON.stringify(res.rows), JSON.stringify(SAIDA_DO_PARSER_ANTIGO))
})

// ─── O contrato com o ETL não mudou ───────────────────────────────────────────

test('as chaves produzidas continuam caindo no mapKey do leads-etl', async () => {
  const data = await xlsxBuffer(ws => {
    ws.addRow(['NOME ', ' Telefone', 'Empresa', 'Origem', 'Status'])
    ws.addRow(['Ana Silva', ' (11) 98888-7777 ', 'Acme', 'site', 'novo'])
  })

  const res = await parse('leads.xlsx', data)
  assert.ok(res.ok)

  const row: Record<string, string> = {}
  for (const [k, v] of Object.entries(res.rows[0])) row[mapKey(k)] = String(v ?? '').trim()

  assert.equal(row.name, 'Ana Silva')
  assert.equal(row.company, 'Acme')
  assert.equal(row.source, 'site')
  assert.equal(row.status, 'novo')
  assert.equal(normalizePhone(row.phone), '+5511988887777')
})

test('telefone numérico continua chegando inteiro ao normalizePhone', async () => {
  const data = await xlsxBuffer(ws => {
    ws.addRow(['nome', 'telefone'])
    ws.addRow(['Ana', 11988887777])
  })
  const res = await parse('leads.xlsx', data)
  assert.ok(res.ok)
  assert.equal(normalizePhone(String(res.rows[0].telefone ?? '').trim()), '+5511988887777')
})

// ─── .csv ─────────────────────────────────────────────────────────────────────

test('.csv com vírgula', async () => {
  const res = await parse('leads.csv', csvBuffer('nome,telefone,empresa\nAna Silva,+5511988887777,Acme\nBruno,11977776666,\n'))
  assert.ok(res.ok)
  assert.deepEqual(res.rows, [
    { nome: 'Ana Silva', telefone: '+5511988887777', empresa: 'Acme' },
    { nome: 'Bruno',     telefone: '11977776666',    empresa: '' },
  ])
})

test('.csv com ponto-e-vírgula (exportação pt-BR do Excel)', async () => {
  const res = await parse('leads.csv', csvBuffer('Nome;Telefone;Empresa\nAna Silva;+5511988887777;Acme, Ltda\n'))
  assert.ok(res.ok)
  assert.deepEqual(res.rows, [{ Nome: 'Ana Silva', Telefone: '+5511988887777', Empresa: 'Acme, Ltda' }])
})

test('.csv respeita aspas, vírgula dentro do campo, aspas escapadas e CRLF', async () => {
  const res = await parse('leads.csv', csvBuffer('nome,empresa\r\n"Silva, Ana","Acme ""A"" Ltda"\r\n'))
  assert.ok(res.ok)
  assert.deepEqual(res.rows, [{ nome: 'Silva, Ana', empresa: 'Acme "A" Ltda' }])
})

test('.csv com BOM e acento no cabeçalho', async () => {
  const BOM = String.fromCharCode(0xfeff)   // via fromCharCode: U+FEFF cru no fonte é invisível
  const res = await parse('leads.csv', csvBuffer(BOM + 'Nome,Observação\nAna,ok\n'))
  assert.ok(res.ok)
  assert.deepEqual(Object.keys(res.rows[0]), ['Nome', 'Observação'])
})

test('.csv salvo em windows-1252 não vira mojibake', async () => {
  const res = await parse('leads.csv', new Uint8Array(Buffer.from('Nome;Observa\xe7\xe3o\nAna;ok\n', 'latin1')))
  assert.ok(res.ok)
  assert.deepEqual(Object.keys(res.rows[0]), ['Nome', 'Observação'])
})

test('.csv com linhas em branco no meio as ignora', async () => {
  const res = await parse('leads.csv', csvBuffer('nome,telefone\nAna,11988887777\n\n,\nBruno,11977776666\n'))
  assert.ok(res.ok)
  assert.deepEqual(res.rows.map(r => r.nome), ['Ana', 'Bruno'])
})

test('.csv vazio é recusado', async () => {
  const res = await parse('leads.csv', csvBuffer(''))
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.semLinhas)
})

test('arquivo binário renomeado para .csv é recusado com mensagem amigável', async () => {
  const res = await parse('leads.csv', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x00, 0x02]))
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.csvInvalido)
})

// ─── Limite de linhas: corta durante a leitura, não depois ───────────────────

test('.xlsx acima do limite para de ler na linha do limite (não materializa o resto)', async () => {
  const EXCEDENTE = 500
  const data = await xlsxBuffer(ws => {
    ws.addRow(['nome', 'telefone'])
    for (let i = 0; i < MAX_ROWS + EXCEDENTE; i++) ws.addRow([`Lead ${i}`, `1198888${String(i).padStart(4, '0')}`])
  })

  const res = await parse('leads.xlsx', data)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.muitasLinhas)
  // Prova de que a leitura parou: só MAX_ROWS+1 linhas de dados foram visitadas,
  // e não as MAX_ROWS+EXCEDENTE que o arquivo tem.
  assert.equal(res.rowsScanned, MAX_ROWS + 1)
  assert.ok(res.rowsScanned < MAX_ROWS + EXCEDENTE)
})

test('.xlsx exatamente no limite passa', async () => {
  const data = await xlsxBuffer(ws => {
    ws.addRow(['nome', 'telefone'])
    for (let i = 0; i < MAX_ROWS; i++) ws.addRow([`Lead ${i}`, `1198888${String(i).padStart(4, '0')}`])
  })
  const res = await parse('leads.xlsx', data)
  assert.ok(res.ok)
  assert.equal(res.rows.length, MAX_ROWS)
  assert.equal(res.rowsScanned, MAX_ROWS)
})

test('.csv acima do limite também para na linha do limite', async () => {
  const EXCEDENTE = 500
  const linhas = ['nome,telefone']
  for (let i = 0; i < MAX_ROWS + EXCEDENTE; i++) linhas.push(`Lead ${i},1198888${String(i).padStart(4, '0')}`)

  const res = await parse('leads.csv', csvBuffer(linhas.join('\n')))
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.muitasLinhas)
  assert.equal(res.rowsScanned, MAX_ROWS + 1)
})

// ─── Limite de colunas: corta antes de montar os objetos de linha ────────────

/** Heap usado e tempo gasto rodando `fn`, para provar que o corte é barato. */
async function custo(fn: () => Promise<unknown>) {
  global.gc?.()
  const heapAntes = process.memoryUsage().heapUsed
  const t0 = Date.now()
  const valor = await fn()
  return { valor, heapMB: (process.memoryUsage().heapUsed - heapAntes) / 1024 / 1024, ms: Date.now() - t0 }
}

test('.csv largo demais é recusado sem estourar memória nem tempo', async () => {
  // 25 mil colunas × 100 linhas: sem o teto, isto viraria 2,5 milhões de
  // chaves de objeto (centenas de MB) a partir de um arquivo de ~2,5 MB.
  const COLS = 25_000, LINHAS = 100
  const linha = 'x' + ','.repeat(COLS - 1)
  const texto = [Array(COLS).fill('c').join(','), ...Array(LINHAS).fill(linha)].join('\n')
  const data = csvBuffer(texto)
  assert.ok(data.length < 5 * 1024 * 1024, 'fixture tem que caber no limite de tamanho')

  const { valor, heapMB, ms } = await custo(() => parse('leads.csv', data))
  const res = valor as Awaited<ReturnType<typeof parse>>
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.muitasColunas)
  assert.ok(heapMB < 80, `heap deveria ficar contido, gastou ${heapMB.toFixed(1)} MB`)
  assert.ok(ms < 5000, `deveria recusar rápido, levou ${ms} ms`)
})

test('.csv: o corte de colunas acontece na varredura, não depois', async () => {
  // Uma linha só, larguíssima: se o registro pudesse crescer sem limite, o
  // array de campos já teria estourado antes de qualquer verificação.
  const data = csvBuffer(Array(200_000).fill('c').join(','))
  const { valor, heapMB } = await custo(() => parse('leads.csv', data))
  const res = valor as Awaited<ReturnType<typeof parse>>
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.muitasColunas)
  assert.ok(heapMB < 80, `heap deveria ficar contido, gastou ${heapMB.toFixed(1)} MB`)
})

test('.xlsx largo demais é recusado antes de montar as linhas', async () => {
  const COLS = 2000
  const data = await xlsxBuffer(ws => {
    ws.addRow(Array.from({ length: COLS }, (_, i) => `c${i}`))
    for (let r = 0; r < 20; r++) ws.addRow(Array.from({ length: COLS }, () => 'x'))
  })
  const res = await parse('leads.xlsx', data)
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.muitasColunas)
  assert.equal(res.rowsScanned, 0, 'nenhuma linha pode ter sido lida')
})

test('exatamente MAX_COLS colunas passa', async () => {
  const data = await xlsxBuffer(ws => {
    ws.addRow(Array.from({ length: MAX_COLS }, (_, i) => `c${i}`))
    ws.addRow(Array.from({ length: MAX_COLS }, () => 'x'))
  })
  const res = await parse('leads.xlsx', data)
  assert.ok(res.ok)
  assert.equal(Object.keys(res.rows[0]).length, MAX_COLS)
})

test('o limite de colunas é configurável', async () => {
  const res = await parse('leads.csv', csvBuffer('a,b,c,d\n1,2,3,4\n'), { maxCols: 3 })
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.muitasColunas)
})

// ─── Zip bomb: o orçamento vale sobre os bytes REALMENTE inflados ────────────

test('zip que mente o tamanho descomprimido não passa do orçamento', async () => {
  // Arquivo pequeno que infla MUITO. O campo do diretório central é reescrito
  // para declarar 100 bytes: o portão antigo (que lia esse campo) deixava
  // passar e o exceljs inflava tudo.
  const grande = await xlsxBuffer(ws => {
    ws.addRow(['nome', 'telefone'])
    for (let i = 0; i < 40_000; i++) ws.addRow([`Lead ${i}`, '11988887777'])
  })
  const mentiroso = Uint8Array.from(grande)
  const view = new DataView(mentiroso.buffer, mentiroso.byteOffset, mentiroso.byteLength)
  let eocd = -1
  for (let i = mentiroso.length - 22; i >= 0; i--) {
    if (mentiroso[i] === 0x50 && mentiroso[i + 1] === 0x4b && mentiroso[i + 2] === 0x05 && mentiroso[i + 3] === 0x06) { eocd = i; break }
  }
  assert.ok(eocd > 0)
  let off = view.getUint32(eocd + 16, true)
  for (let n = 0; n < view.getUint16(eocd + 10, true); n++) {
    view.setUint32(off + 24, 100, true)                  // "descomprime para 100 bytes"
    off += 46 + view.getUint16(off + 28, true) + view.getUint16(off + 30, true) + view.getUint16(off + 32, true)
  }

  const { valor, heapMB, ms } = await custo(() => parseImportFile(
    { fileName: 'leads.xlsx', data: mentiroso },
    { maxUnzipped: 1024 * 1024 },                        // orçamento de 1 MB
  ))
  const res = valor as ParseResult
  assert.equal(res.ok, false)
  assert.equal(res.ok === false && res.error, IMPORT_ERRORS.tamanho)
  assert.ok(heapMB < 80, `o corte tem que ser antes de inflar tudo, gastou ${heapMB.toFixed(1)} MB`)
  assert.ok(ms < 5000, `deveria recusar rápido, levou ${ms} ms`)

  // E o mesmo arquivo passa quando o orçamento comporta o que ele realmente infla.
  const medido = checkInflatedSize(mentiroso, 512 * 1024 * 1024)
  assert.equal(medido.ok, true)
  assert.ok(medido.bytes > 1024 * 1024, 'infla MUITO mais que os 100 bytes declarados')
})

test('o limite de linhas é configurável e corta na hora certa', async () => {
  const data = await xlsxBuffer(ws => {
    ws.addRow(['nome'])
    for (let i = 0; i < 10; i++) ws.addRow([`Lead ${i}`])
  })
  const res = await parse('leads.xlsx', data, { maxRows: 3 })
  assert.equal(res.ok, false)
  assert.equal(res.rowsScanned, 4)
})
