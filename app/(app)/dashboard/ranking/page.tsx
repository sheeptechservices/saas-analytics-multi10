import { redirectFromHiddenRoute } from '@/lib/hidden-route'

// O Ranking era calculado sobre os leads do CRM que saiu do produto. Volta
// quando for refeito sobre os dados do SDR; até lá, a rota só redireciona.
export default async function RankingPage() {
  return redirectFromHiddenRoute()
}
