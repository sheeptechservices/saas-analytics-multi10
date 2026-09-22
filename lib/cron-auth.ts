import { timingSafeEqualStrings } from '@/lib/timing-safe'

// Autorização das rotas de /api/cron/*, chamadas por agendador externo (sem sessão).
//
// A comparação antiga — authHeader !== `Bearer ${process.env.CRON_SECRET}` — aceitava
// o cabeçalho "Bearer undefined" quando CRON_SECRET não estava definido: o template
// vira a string "Bearer undefined" e qualquer um dispara o sync completo de todos os
// tenants. Só não era explorável porque o middleware barrava /api/cron antes do
// handler. Sem segredo configurado, a rota fica fechada.
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET não definido — chamada recusada')
    return false
  }

  // Comparação em tempo constante — ver lib/timing-safe.ts.
  return timingSafeEqualStrings(request.headers.get('authorization') ?? '', `Bearer ${secret}`)
}
