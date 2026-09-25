/* Catálogo das variáveis de ambiente e conferência delas no arranque do servidor.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * A ARMADILHA QUE ESTE ARQUIVO NÃO PODE REPETIR
 *
 * O deploy já morreu uma vez porque `lib/db/index.ts` criava o cliente do banco
 * na AVALIAÇÃO DO MÓDULO: o `next build` importa cada rota no passo "collecting
 * page data", a variável não existia na imagem de build e o build inteiro caía.
 * O conserto foi deixar tudo preguiçoso, e a CI hoje constrói SEM NENHUMA
 * variável de banco (.github/workflows/ci.yml, job "build de produção") só para
 * que aquele defeito não volte.
 *
 * Um arquivo que "valida o ambiente" é o convite perfeito para o mesmo erro em
 * roupa nova. Por isso, duas regras que valem para sempre aqui:
 *
 *   1. NADA neste módulo lê `process.env` na importação. O catálogo abaixo é
 *      dado estático; toda leitura acontece dentro de função, chamada pelo
 *      `instrumentation.ts`.
 *   2. NADA aqui importa `node:*`. Este módulo entra também no pacote do edge
 *      (o `instrumentation.ts` é compilado para os dois runtimes quando existe
 *      `middleware.ts`, que existe), e `node:fs` lá quebraria o build.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * OS QUATRO NÍVEIS, E POR QUE SÃO QUATRO
 *
 * Marcar como obrigatória uma variável que a produção não tem transforma o
 * deploy seguinte em apagão: o contêiner não sobe, e o app inteiro cai por causa
 * de algo que até ontem funcionava. Então o nível não é opinião sobre o que
 * seria bonito ter — é uma aposta sobre o que já está lá.
 *
 *   obrigatoria  Sem ela o servidor não tem como responder certo a NADA.
 *                Em produção, derruba o arranque. Fora de produção, vira aviso.
 *   recomendada  Sem ela um pedaço do produto para, o resto continua de pé.
 *                Nunca derruba: aviso no arranque, em qualquer ambiente.
 *   opcional     Botão que a maioria das instalações não aperta. NUNCA avisa —
 *                avisar sobre algo que deve ficar vazio é ruído que ensina o
 *                operador a ignorar o log. Só é conferida se estiver definida.
 *   proibida     Definir QUEBRA o app. Presente = erro, sempre.
 *
 * `APP_ROOT_DOMAIN` é o caso que forçou o nível "opcional" a existir: ela só faz
 * sentido quando cada cliente ganha um subdomínio próprio, e apontá-la para o
 * domínio compartilhado da hospedagem seria ativamente nocivo (passaria a
 * aceitar QUALQUER subdomínio daquele domínio como host confiável em link de
 * e-mail). Ela está deliberadamente vazia em produção e não pode virar aviso. */

export type Ambiente = Record<string, string | undefined>

export type Nivel = 'obrigatoria' | 'recomendada' | 'opcional' | 'proibida'

/** Quem define a variável — muda quem é o dono do problema quando ela falta. */
export type Onde =
  | 'servidor'    // o operador define no ambiente do serviço
  | 'plataforma'  // a hospedagem ou o próprio Next define; ninguém digita
  | 'script'      // só os scripts de npm (create-master, seed-300) leem

export interface Variavel {
  nome: string
  nivel: Nivel
  onde: Onde
  /** Uma linha: para que serve. Entra na mensagem de erro do arranque. */
  para: string
  /** Ganha uma linha `NOME=` em `.env.example`? (o teste de deriva confere) */
  documentar: boolean
  /** O que há de errado com o valor, ou null. Só roda com valor não vazio. */
  validar?: (valor: string) => string | null
  /** Suspeita que não justifica derrubar nada. Só roda com valor não vazio. */
  avisar?: (valor: string, producao: boolean) => string | null
  /** Motivo pelo qual ela é obrigatória NESTE ambiente, ou null. */
  exigidaQuando?: (env: Ambiente) => string | null
}

/* ─── Auxiliares de validação ─────────────────────────────────────────────── */

/** Vazia, só espaço, ou ausente — os três são a mesma coisa para o operador. */
export function valorDe(env: Ambiente, nome: string): string | undefined {
  const bruto = env[nome]
  if (typeof bruto !== 'string') return undefined
  const limpo = bruto.trim()
  return limpo === '' ? undefined : limpo
}

function ehDigitoHex(codigo: number): boolean {
  return (
    (codigo >= 48 && codigo <= 57) ||  // 0-9
    (codigo >= 97 && codigo <= 102) || // a-f
    (codigo >= 65 && codigo <= 70)     // A-F
  )
}

/**
 * Quantos bytes `Buffer.from(texto, 'hex')` produziria — sem usar `Buffer`,
 * que não existe garantidamente no edge.
 *
 * Reproduz a regra do Node, que é mais frouxa do que parece: ele decodifica os
 * pares de dígitos hex do COMEÇO da string e para no primeiro caractere que não
 * é hex, descartando em silêncio o resto e um dígito ímpar sobrando. Ou seja,
 * 65 e 66 caracteres 'a' também dão 32 bytes.
 *
 * Reproduzir em vez de inventar `/^[0-9a-f]{64}$/` é deliberado: essa regex é a
 * regra que a issue #105 descreve, mas NÃO é a regra que `lib/crypto.ts` aplica.
 * Se a validação recusasse um valor que o `getKey()` aceita, o primeiro deploy
 * depois desta mudança viraria apagão por causa de um espaço sobrando — trocar
 * "a criptografia falha" por "o app não sobe" é o pior negócio possível. Quem
 * garante que as duas concordam é `lib/ambiente.test.ts`, comparando esta função
 * com o `Buffer` de verdade numa tabela de casos de borda.
 */
export function bytesDeHex(texto: string): number {
  let digitos = 0
  while (digitos < texto.length && ehDigitoHex(texto.charCodeAt(digitos))) digitos++
  return digitos >> 1
}

function comoUrl(valor: string): URL | null {
  try {
    return new URL(valor)
  } catch {
    return null
  }
}

const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

/* Domínios de exemplo que nunca são de ninguém. O primeiro é o que estava
 * escrito à mão nas duas rotas de e-mail como valor de reserva — mandar dele
 * significa mandar de um domínio que não temos, e a Resend recusa (ou, pior,
 * aceita e a mensagem morre no antispam de quem recebe). */
const DOMINIOS_DE_EXEMPLO = new Set([
  'yourdomain.com', 'seudominio.com', 'seudominio.com.br',
  'example.com', 'example.net', 'example.org', 'exemplo.com', 'exemplo.com.br',
])

/* O domínio pronto da Resend. Ele FUNCIONA — por isso não é erro — mas, por não
 * ser verificado, a Resend só entrega para o endereço dono da conta. Qualquer
 * outro destinatário é recusado, o que significa que a recuperação de senha e o
 * convite de novo usuário não chegam a ninguém. É o pior tipo de configuração:
 * funciona o bastante para parecer certa e pouco o bastante para não servir.
 * Vira aviso, não erro, porque em desenvolvimento ele é exatamente o que se quer. */
const DOMINIOS_DE_TESTE = new Set(['resend.dev'])

/* Domínios de hospedagem que várias aplicações compartilham. Não são "nossos"
 * por estarmos neles. */
const HOSPEDAGENS_COMPARTILHADAS = new Set([
  'up.railway.app', 'railway.app', 'vercel.app', 'onrender.com',
  'herokuapp.com', 'netlify.app', 'fly.dev', 'pages.dev',
])

/* Forma mínima de endereço. Não vale a pena ir além: a autoridade sobre o que é
 * um remetente válido é a Resend, e a única coisa que precisamos impedir aqui é
 * o valor de mentira passar por valor de verdade. */
const FORMA_DE_ENDERECO = /^[^\s@<>]+@[^\s@<>.]+(\.[^\s@<>.]+)+$/

/** `a@b.com` ou `Nome <a@b.com>` — a Resend aceita as duas formas, e a segunda
 *  é a que a produção provavelmente usa; recusá-la seria quebrar o que funciona. */
export function enderecoDoRemetente(valor: string): string | null {
  const entreSinais = valor.match(/<([^<>]+)>\s*$/)
  const endereco = (entreSinais ? entreSinais[1] : valor).trim()
  return FORMA_DE_ENDERECO.test(endereco) ? endereco : null
}

function validarRemetente(valor: string): string | null {
  const endereco = enderecoDoRemetente(valor)
  if (!endereco) {
    return 'não é um endereço de e-mail (esperado `nome@dominio` ou `Nome <nome@dominio>`)'
  }
  const dominio = endereco.slice(endereco.lastIndexOf('@') + 1).toLowerCase()
  if (DOMINIOS_DE_EXEMPLO.has(dominio)) {
    return 'usa um domínio de exemplo, que não é nosso — a Resend recusa o envio e ninguém recebe nada'
  }
  return null
}

/** Suspeita sobre o remetente: funciona, mas provavelmente não entrega. */
function avisarRemetente(valor: string, producao: boolean): string | null {
  if (!producao) return null
  const endereco = enderecoDoRemetente(valor)
  const dominio = endereco ? endereco.slice(endereco.lastIndexOf('@') + 1).toLowerCase() : null
  if (dominio && DOMINIOS_DE_TESTE.has(dominio)) {
    return `usa ${dominio}, o domínio de teste da Resend: ele só entrega para o e-mail dono ` +
      'da conta, então recuperação de senha e convite não chegam a mais ninguém. ' +
      'Verifique um domínio próprio na Resend e aponte o remetente para ele.'
  }
  return null
}

/* ─── O catálogo ──────────────────────────────────────────────────────────────
 *
 * Esta lista é a única fonte da verdade sobre o ambiente deste app:
 * `.env.example` é conferido contra ela, e todo `process.env.<NOME>` do
 * repositório também (lib/ambiente-documentado.test.ts). Variável nova sem entrada aqui
 * reprova o `npm test`. */
export const CATALOGO: readonly Variavel[] = [
  // ── Obrigatórias ───────────────────────────────────────────────────────────
  {
    nome: 'DATABASE_URL',
    nivel: 'obrigatoria',
    onde: 'servidor',
    documentar: true,
    para: 'URL do Postgres (Railway). Não existe banco de reserva: sem ela nenhuma página carrega.',
    /* Conferência de propósito fraca — prefixo, não `new URL` completo. Senha de
     * banco pode ter caractere que o analisador de URL interpreta de outro jeito,
     * e recusar uma URL que o driver aceitaria seria trocar "o banco não responde"
     * por "o app não sobe". O que esta linha precisa pegar é o erro real: sobrou
     * um `libsql://` do Turso, ou colaram um host solto sem esquema. */
    validar: valor =>
      /^postgres(ql)?:\/\//i.test(valor)
        ? null
        : 'não começa com postgres:// nem postgresql:// (uma URL libsql:// do Turso antigo não serve mais)',
  },
  {
    nome: 'ENCRYPTION_SECRET',
    nivel: 'obrigatoria',
    onde: 'servidor',
    documentar: true,
    para: 'Chave AES-256-GCM das credenciais de integração guardadas no banco (lib/crypto.ts).',
    validar: valor =>
      bytesDeHex(valor) === 32
        ? null
        : 'não vira uma chave de 32 bytes: precisa de 64 caracteres hexadecimais (openssl rand -hex 32)',
    /* O `Buffer.from(x, 'hex')` do Node aceita lixo depois dos 64 dígitos e o
     * descarta calado. Quem colou um caractere a mais acha que trocou a chave e
     * não trocou — e trocar a chave de verdade torna ilegível toda credencial já
     * salva. Aviso, não erro: o valor FUNCIONA, só não é o que parece. */
    avisar: valor =>
      /^[0-9a-fA-F]{64}$/.test(valor)
        ? null
        : 'tem caracteres além dos 64 dígitos hexadecimais que valem; o resto é descartado em silêncio',
  },
  {
    nome: 'APP_URL',
    nivel: 'obrigatoria',
    onde: 'servidor',
    documentar: true,
    para: 'Origem de reserva do app: link de e-mail quando o host do pedido é desconhecido, e URL do webhook na YCloud.',
    /* Obrigatória porque a falta dela não dá erro nenhum — `configuredOrigin()`
     * cai calada em http://localhost:3000, e o convite sai com um link para a
     * máquina de quem clicou. Falha silenciosa que parece sucesso é exatamente o
     * que esta conferência existe para transformar em falha barulhenta. */
    validar: valor => {
      const url = comoUrl(valor)
      if (!url) return 'não é uma URL absoluta (esperado algo como https://app.seudominio.com.br)'
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return 'usa um esquema que não é http nem https'
      }
      return null
    },
    /* Aviso e não erro: existe deploy legítimo atrás de um túnel ou numa rede
     * fechada. Mas em produção o caso comum é ter esquecido o valor de
     * desenvolvimento, e aí todo link de convite aponta para a máquina de quem
     * abriu o e-mail. */
    avisar: (valor, producao) => {
      if (!producao) return null
      const url = comoUrl(valor)
      if (!url) return null
      return HOSTS_LOCAIS.has(url.hostname.toLowerCase())
        ? 'aponta para a própria máquina; em produção os links de convite e de redefinição de senha sairiam apontando para localhost'
        : null
    },
  },
  {
    nome: 'RESEND_FROM_EMAIL',
    nivel: 'obrigatoria',
    onde: 'servidor',
    documentar: true,
    para: 'Remetente dos e-mails de convite e de redefinição de senha.',
    /* Obrigatória CONDICIONAL: só quando há chave da Resend. Assim a exigência
     * nunca derruba uma instalação que simplesmente não manda e-mail (a produção
     * de hoje tem as duas, então aqui não há aposta nenhuma), e ao mesmo tempo
     * "chave sim, remetente não" — a configuração pela metade que mandava do
     * `noreply@yourdomain.com` escrito no código — deixa de existir. */
    exigidaQuando: env =>
      valorDe(env, 'RESEND_API_KEY')
        ? 'RESEND_API_KEY está definida, e sem remetente nenhum e-mail pode sair'
        : null,
    validar: validarRemetente,
    avisar: avisarRemetente,
  },

  /* ── Obrigatórias em par ────────────────────────────────────────────────────
   * O nível individual é "opcional" porque, sozinha, nenhuma das duas é exigida:
   * quem exige é o GRUPOS_OU lá embaixo, que cobra pelo menos uma. Marcar as
   * duas como obrigatórias cobraria as duas, que é uma regra que o next-auth
   * não tem. */
  {
    nome: 'AUTH_SECRET',
    nivel: 'opcional',
    onde: 'servidor',
    documentar: true,
    para: 'Segredo que assina a sessão (next-auth), no nome novo; tem precedência sobre NEXTAUTH_SECRET. Pelo menos uma das duas é obrigatória.',
  },
  {
    nome: 'NEXTAUTH_SECRET',
    nivel: 'opcional',
    onde: 'servidor',
    documentar: true,
    para: 'O mesmo segredo, no nome antigo; o next-auth usa este quando AUTH_SECRET não existe. Pelo menos uma das duas é obrigatória.',
  },

  // ── Recomendadas ───────────────────────────────────────────────────────────
  {
    nome: 'CRON_SECRET',
    nivel: 'recomendada',
    onde: 'servidor',
    documentar: true,
    para: 'Bearer exigido por /api/cron/* (lib/cron-auth.ts). O agendador manda o mesmo valor.',
    /* Recomendada, não obrigatória: sem ela o app serve todas as telas
     * normalmente, só o sync diário para. Derrubar o servidor inteiro por causa
     * de um agendador seria desproporcional — mas a falha é silenciosa (a rota
     * devolve 401 e os dados envelhecem sem ninguém notar), então ela merece um
     * aviso em todo arranque. */
  },
  {
    nome: 'RESEND_API_KEY',
    nivel: 'recomendada',
    onde: 'servidor',
    documentar: true,
    para: 'Chave da Resend. Sem ela o app não manda convite nem redefinição de senha.',
    /* Recomendada de propósito, e é a decisão mais discutível deste arquivo.
     * Obrigatória transformaria "quem gira a chave da Resend" em "quem derruba o
     * produto": o painel, os relatórios e o SDR continuam corretos sem e-mail
     * nenhum. Em compensação a degradação não pode mais ser muda — em produção,
     * `configuracaoDeEmail()` recusa o pedido com erro visível em vez de fingir
     * que mandou (era o comportamento antigo: `console.warn` e um 200 alegre). */
  },

  // ── Opcionais: nunca avisam ────────────────────────────────────────────────
  {
    nome: 'APP_ROOT_DOMAIN',
    nivel: 'opcional',
    /* Definida com o domínio compartilhado da hospedagem, ela faz o app aceitar
     * QUALQUER aplicação daquele domínio como host confiável em link de e-mail —
     * que é justamente o que o cabeçalho deste arquivo chama de nocivo. Aviso, e
     * não erro: quem a definiu assim tem um app no ar e derrubá-lo seria pior. */
    avisar: (valor, producao) => {
      if (!producao) return null
      const limpo = valor.trim().toLowerCase().replace(/^\./, '')
      return HOSPEDAGENS_COMPARTILHADAS.has(limpo)
        ? `é o domínio compartilhado da hospedagem (${limpo}): com ele, qualquer aplicação ` +
          'ali vira host confiável para link de e-mail com token dentro. Use um domínio seu, ' +
          'ou deixe a variável vazia.'
        : null
    },
    onde: 'servidor',
    documentar: true,
    para: 'Domínio raiz da plataforma, quando cada cliente tem subdomínio próprio. Deve ficar VAZIO na hospedagem compartilhada.',
    validar: valor => {
      if (comoUrl(valor)) return 'é uma URL; aqui vai só o domínio, sem https:// e sem barra'
      if (valor.includes('/') || valor.includes('@') || /\s/.test(valor)) {
        return 'não é um domínio (sobrou barra, arroba ou espaço)'
      }
      if (!valor.replace(/^\./, '').includes('.')) return 'não parece um domínio: falta o ponto'
      return null
    },
  },
  {
    nome: 'DATABASE_CA_CERT',
    nivel: 'opcional',
    onde: 'servidor',
    documentar: true,
    para: 'PEM da CA do Postgres, quando se quer verificação completa do certificado na URL pública.',
    validar: valor =>
      valor.includes('-----BEGIN CERTIFICATE-----')
        ? null
        : 'não parece um PEM: falta a linha -----BEGIN CERTIFICATE-----',
  },
  {
    nome: 'PGSSLMODE',
    nivel: 'opcional',
    onde: 'servidor',
    documentar: true,
    para: 'Saída de emergência do TLS do Postgres. Quem confere de verdade é lib/db/index.ts, no primeiro uso.',
    /* Sem validação aqui de propósito: a lista de valores que o driver reconhece
     * mora em `lib/db/index.ts`, junto do código que depende dela, e importar
     * aquele módulo daqui arrastaria o `pg` para dentro do pacote do edge. Duas
     * listas seria pior do que uma conferência tardia. */
  },

  // ── Proibidas ──────────────────────────────────────────────────────────────
  {
    nome: 'NEXTAUTH_URL',
    nivel: 'proibida',
    onde: 'servidor',
    documentar: false,
    para: 'O next-auth reescreve a origem de TODA requisição com este valor (next-auth/lib/env.js, reqWithEnvURL).',
  },
  {
    nome: 'AUTH_URL',
    nivel: 'proibida',
    onde: 'servidor',
    documentar: false,
    para: 'Mesmo efeito de NEXTAUTH_URL, no nome novo do next-auth.',
  },

  // ── Scripts de npm, nunca o servidor ───────────────────────────────────────
  {
    nome: 'MASTER_EMAIL',
    nivel: 'opcional',
    onde: 'script',
    documentar: true,
    para: 'E-mail da conta master criada por `npm run create-master` (lib/db/create-master.ts).',
  },
  {
    nome: 'MASTER_PASSWORD',
    nivel: 'opcional',
    onde: 'script',
    documentar: true,
    para: 'Senha da conta master criada por `npm run create-master`.',
  },
  {
    nome: 'TENANT_300_EMAIL',
    nivel: 'opcional',
    onde: 'script',
    documentar: true,
    para: 'E-mail do admin criado por `npm run seed-300` (lib/db/seed-300.ts).',
  },
  {
    nome: 'TENANT_300_PASSWORD',
    nivel: 'opcional',
    onde: 'script',
    documentar: true,
    para: 'Senha do admin criado por `npm run seed-300`.',
  },

  // ── Plataforma: ninguém digita ─────────────────────────────────────────────
  {
    nome: 'NODE_ENV',
    nivel: 'opcional',
    onde: 'plataforma',
    documentar: true,
    para: 'development | production | test. O próprio `next` define quando não vem de fora.',
  },
  {
    nome: 'PORT',
    nivel: 'opcional',
    onde: 'plataforma',
    documentar: true,
    para: 'Porta do servidor. A hospedagem define sozinha; em desenvolvimento, a mesma de .claude/launch.json.',
  },
  {
    nome: 'RAILWAY_ENVIRONMENT_NAME',
    nivel: 'opcional',
    onde: 'plataforma',
    documentar: false,
    para: 'Nome do ambiente na Railway. Vai para application_name do Postgres e para o rótulo da trava do cron.',
  },
  {
    nome: 'VERCEL',
    nivel: 'opcional',
    onde: 'plataforma',
    documentar: false,
    para: 'Marca de implantação na Vercel. Só rotula a trava do cron — sobra da migração para a Railway.',
  },
  {
    nome: 'NEXT_PHASE',
    nivel: 'opcional',
    onde: 'plataforma',
    documentar: false,
    para: 'O Next define como phase-production-build durante o `next build`. É o que impede esta conferência de rodar no build.',
  },
  {
    nome: 'IS_NEXT_WORKER',
    nivel: 'opcional',
    onde: 'plataforma',
    documentar: false,
    para: 'O Next define nos processos filhos do build (next/dist/lib/worker.js). Segundo sinal do mesmo portão.',
  },
  {
    nome: 'NEXT_RUNTIME',
    nivel: 'opcional',
    onde: 'plataforma',
    documentar: false,
    para: 'nodejs | edge. Substituída em tempo de compilação; separa o instrumentation do servidor do da borda.',
  },
]

/** Grupos em que basta UMA das variáveis existir. */
export interface GrupoOu {
  nomes: readonly string[]
  para: string
}

export const GRUPOS_OU: readonly GrupoOu[] = [
  {
    /* O next-auth resolve `config.secret ?? (process.env.AUTH_SECRET ??
     * process.env.NEXTAUTH_SECRET)` — conferido em
     * node_modules/next-auth/lib/env.js. Sem nenhuma das duas, toda requisição
     * autenticada estoura com MissingSecret. Exigir as duas seria inventar uma
     * regra que o next-auth não tem; exigir uma é a regra dele. */
    nomes: ['AUTH_SECRET', 'NEXTAUTH_SECRET'],
    para: 'sem um segredo de sessão o next-auth recusa toda requisição autenticada',
  },
]

/* ─── Conferência ─────────────────────────────────────────────────────────── */

export interface Diagnostico {
  /** Motivos para não deixar o servidor subir em produção. */
  erros: string[]
  /** Coisas que merecem uma linha no log e não merecem derrubar nada. */
  avisos: string[]
}

/**
 * Lê o ambiente inteiro e devolve TUDO que está errado de uma vez.
 *
 * Nunca para no primeiro problema, e nunca ecoa um valor — só nomes. Quem
 * reinicia um contêiner às três da manhã precisa descobrir os cinco erros numa
 * passada, e não pode arriscar um segredo aparecer no log da hospedagem.
 *
 * `producao` muda só as conferências que dependem do ambiente (hoje, o aviso de
 * APP_URL apontando para localhost). Quem decide entre derrubar e avisar é o
 * chamador — `instrumentation.ts`.
 */
export function conferirAmbiente(env: Ambiente, producao: boolean): Diagnostico {
  const erros: string[] = []
  const avisos: string[] = []

  for (const v of CATALOGO) {
    const valor = valorDe(env, v.nome)

    if (v.nivel === 'proibida') {
      if (valor !== undefined) {
        erros.push(`${v.nome} está definida e NÃO PODE ESTAR. ${v.para} Apague a variável do ambiente.`)
      }
      continue
    }

    if (valor === undefined) {
      const motivoCondicional = v.exigidaQuando?.(env) ?? null
      if (v.nivel === 'obrigatoria' && !v.exigidaQuando) {
        erros.push(`${v.nome} não está definida. ${v.para}`)
      } else if (motivoCondicional) {
        erros.push(`${v.nome} não está definida — e agora é obrigatória: ${motivoCondicional}. ${v.para}`)
      } else if (v.nivel === 'recomendada') {
        avisos.push(`${v.nome} não está definida. ${v.para}`)
      }
      continue
    }

    const problema = v.validar?.(valor) ?? null
    if (problema) {
      erros.push(`${v.nome} ${problema}. ${v.para}`)
      continue
    }

    const suspeita = v.avisar?.(valor, producao) ?? null
    if (suspeita) avisos.push(`${v.nome} ${suspeita}.`)
  }

  for (const grupo of GRUPOS_OU) {
    if (grupo.nomes.some(nome => valorDe(env, nome) !== undefined)) continue
    const alternativas = grupo.nomes.join(' ou ')
    erros.push(`${alternativas}: nenhuma das duas está definida, e pelo menos uma precisa estar — ${grupo.para}.`)
  }

  return { erros, avisos }
}

/* ─── Quando conferir ─────────────────────────────────────────────────────── */

export type Modo =
  | 'ignorar'  // estamos num build, não num servidor: não olhar para nada
  | 'avisar'   // servidor fora de produção: registrar, nunca derrubar
  | 'exigir'   // servidor de produção: erro derruba o arranque

/**
 * O portão que impede esta conferência de virar o apagão de 2025 outra vez.
 *
 * O `register()` do `instrumentation.ts` roda no arranque do servidor — e o Next
 * 15.5.26 NÃO o chama durante o `next build`: há uma guarda explícita em
 * `next/dist/server/lib/router-utils/instrumentation-globals.external.js`
 * (e a gêmea dela em `server/web/globals.js`, para a borda) que sai cedo quando
 * `NEXT_PHASE === 'phase-production-build'`. O `next build` define essa variável
 * em `next/dist/build/index.js`, logo antes de abrir os processos filhos que
 * coletam os dados das páginas — os mesmos que derrubaram o deploy da outra vez.
 * `lib/instrumentacao.test.ts` prova isso executando o módulo real do Next.
 *
 * Só que depender da guarda DELES é depender de uma linha que uma atualização
 * pode remover sem avisar. Então repetimos a conferência aqui, com dois sinais
 * independentes:
 *
 *   NEXT_PHASE=phase-production-build  o processo principal do `next build`,
 *                                      herdado por todo filho.
 *   IS_NEXT_WORKER=true                carimbado em cada processo filho do build
 *                                      por next/dist/lib/worker.js, mesmo se a
 *                                      herança do ambiente mudar.
 *
 * Nenhum dos dois é substituído em tempo de compilação (a lista do DefinePlugin
 * está em next/dist/build/define-env.js e não os inclui), então a leitura aqui é
 * do ambiente de verdade, em tempo de execução. `NEXT_RUNTIME` é substituída, e
 * por isso o corte do edge fica no próprio `instrumentation.ts`, literal, onde o
 * empacotador consegue enxergar.
 */
export function modoDeVerificacao(env: Ambiente): Modo {
  if (env.NEXT_PHASE === 'phase-production-build') return 'ignorar'
  if (env.IS_NEXT_WORKER === 'true') return 'ignorar'
  return env.NODE_ENV === 'production' ? 'exigir' : 'avisar'
}

/* ─── A mensagem ──────────────────────────────────────────────────────────── */

/** Uma mensagem só, com TODOS os problemas. Reiniciar um contêiner para
 *  descobrir o erro seguinte é o que esta função existe para evitar. */
export function textoDaFalhaDeAmbiente(erros: readonly string[]): string {
  const quantas = erros.length === 1
    ? '1 variável de ambiente está faltando ou malformada'
    : `${erros.length} variáveis de ambiente estão faltando ou malformadas`
  return [
    `Ambiente inválido: ${quantas}.`,
    '',
    ...erros.map(e => `  • ${e}`),
    '',
    'Corrija TODAS de uma vez nas variáveis do serviço e reinicie — esta lista é completa.',
    'O arquivo .env.example descreve cada variável e as que nunca podem ser definidas.',
  ].join('\n')
}

/* ─── Envio de e-mail ─────────────────────────────────────────────────────── */

/**
 * O estado em que a configuração de e-mail está AGORA.
 *
 * Existe para que `RESEND_FROM_EMAIL` não tenha mais um valor de reserva. As
 * duas rotas que mandam e-mail traziam, cada uma, um
 * `process.env.RESEND_FROM_EMAIL || 'noreply@yourdomain.com'`: com a variável
 * ausente o app tentava mandar de um domínio que não é nosso, a Resend recusava,
 * o erro ia para o `console.error` e a resposta HTTP continuava sendo sucesso.
 * A pessoa via "enviamos as instruções" e nunca recebia nada.
 */
export type ConfigDeEmail =
  | { estado: 'pronto'; apiKey: string; remetente: string }
  /** Sem chave, fora de produção: seguir sem mandar e registrar o link no console. */
  | { estado: 'desligado'; motivo: string }
  /** Configuração pela metade: recusar o pedido em vez de fingir que mandou. */
  | { estado: 'quebrado'; motivo: string }

export function configuracaoDeEmail(env: Ambiente): ConfigDeEmail {
  const apiKey = valorDe(env, 'RESEND_API_KEY')
  const producao = env.NODE_ENV === 'production'

  if (!apiKey) {
    /* Em desenvolvimento, não ter a chave é o normal: o link vai para o console
     * e o fluxo de convite continua testável sem conta na Resend. Em produção a
     * mesma ausência é defeito — e um defeito que, calado, faz o usuário esperar
     * para sempre por um e-mail que nunca foi tentado. */
    return producao
      ? { estado: 'quebrado', motivo: 'RESEND_API_KEY não está definida no ambiente de produção' }
      : { estado: 'desligado', motivo: 'RESEND_API_KEY não está definida' }
  }

  const remetente = valorDe(env, 'RESEND_FROM_EMAIL')
  if (!remetente) {
    return { estado: 'quebrado', motivo: 'RESEND_API_KEY está definida, mas RESEND_FROM_EMAIL não' }
  }

  const problema = validarRemetente(remetente)
  if (problema) return { estado: 'quebrado', motivo: `RESEND_FROM_EMAIL ${problema}` }

  return { estado: 'pronto', apiKey, remetente }
}

/** Frase para quem está do outro lado da tela. Não cita variável de ambiente:
 *  quem pede uma redefinição de senha não tem o que fazer com esse nome, e o
 *  nome da variável não é assunto para um endpoint aberto. O motivo exato vai
 *  para o log do servidor, onde o operador o encontra. */
export const AVISO_DE_EMAIL_INDISPONIVEL =
  'O envio de e-mails não está configurado no servidor, então nada foi enviado. Avise o suporte técnico.'

/** Todos os nomes que este repositório conhece. É o lado "código" da
 *  comparação com `.env.example` feita em `lib/ambiente-documentado.test.ts`. */
export function nomesDoCatalogo(): string[] {
  return CATALOGO.map(v => v.nome)
}

export function variavelDoCatalogo(nome: string): Variavel | undefined {
  return CATALOGO.find(v => v.nome === nome)
}
