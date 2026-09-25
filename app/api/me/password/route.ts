import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { logAudit } from '@/lib/audit'
import { requireTenantUser } from '@/lib/auth-guard'
import { trocarSenhaDoUsuario } from '@/lib/senha-troca'

/* Trocar a própria senha, já logado.
 *
 * Até aqui o produto não tinha esse caminho: quem quisesse mudar a senha
 * precisava sair, pedir o link em /forgot-password e esperar o e-mail. As contas
 * criadas por app/api/users nascem com `bcrypt.hash(crypto.randomUUID(), 12)` —
 * uma senha que ninguém conhece —, então a recuperação por e-mail era a ÚNICA
 * porta de entrada, e continuava sendo a única porta para qualquer troca depois.
 *
 * Fica em /api/me/password porque é o recurso "minha senha": o vizinho /api/me
 * já é o perfil da própria pessoa. PUT, e não POST, pelo mesmo motivo do PUT de
 * /api/me — substitui um valor que já existe.
 *
 * ── O que acontece com as OUTRAS sessões ────────────────────────────────────
 *
 * Nada, e isso é uma limitação conhecida do desenho atual, não um esquecimento.
 *
 * A sessão é JWT (auth.config.ts: `session: { strategy: 'jwt' }`): não existe
 * tabela de sessão. O cookie é um token assinado que carrega id, papel e tenant,
 * e o servidor o aceita por VALIDAR A ASSINATURA, sem consultar o banco. Trocar a
 * linha `users.password_hash` portanto não invalida token nenhum: quem já estiver
 * logado em outro aparelho — inclusive um invasor com o cookie roubado —
 * CONTINUA COM ACESSO até o token expirar, o que pelo padrão do @auth/core são
 * 30 dias de ociosidade (não há `session.maxAge` configurado no projeto).
 *
 * O que dá para fazer hoje é feito em lib/senha-troca.ts: os links de
 * recuperação pendentes são queimados, para que um link vazado não permita
 * desfazer a troca.
 *
 * O conserto de verdade exige MUDANÇA DE SCHEMA, que está fora deste lote: uma
 * coluna `users.password_changed_at` (ou um contador de versão da credencial)
 * gravada no JWT no login e conferida a cada requisição. E não bastaria a coluna:
 * o callback `jwt` de auth.config.ts roda no middleware, no runtime Edge, onde
 * não há `pg` nem acesso ao banco — a checagem teria que descer para os handlers
 * Node, ou a verificação de sessão sairia do Edge. Decisão do dono, em outro
 * lote.
 *
 * Enquanto isso, a tela diz isso em voz alta para o usuário
 * (components/settings/TrocarSenha.tsx), em vez de deixá-lo achar que trocar a
 * senha expulsou alguém. */

export async function PUT(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  /* requireTenantUser, e não requireMaster: trocar a própria senha é de todo
   * mundo que tem conta. A porta do tenant deixa passar o master também
   * (lib/roles.ts: canActInTenant), que é o certo — ele também tem senha. O que
   * ela barra é sessão sem papel nenhum. */
  const roleCheck = requireTenantUser(session)
  if (roleCheck) return roleCheck

  const body = await req.json().catch(() => null) as
    | { senhaAtual?: unknown; novaSenha?: unknown }
    | null

  const resultado = await trocarSenhaDoUsuario({
    userId: session.user.id,
    senhaAtual: body?.senhaAtual,
    novaSenha: body?.novaSenha,
  })

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status })
  }

  /* Sem `metadata`: o registro guarda QUE a senha mudou, quando e de que IP —
   * nunca a senha, nem a antiga nem a nova, nem o hash. */
  await logAudit({
    req,
    session,
    action: 'user.password.change',
    entityType: 'user',
    entityId: session.user.id,
  })

  return NextResponse.json({ message: 'Senha alterada com sucesso.' })
}
