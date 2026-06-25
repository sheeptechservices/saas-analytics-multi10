import { redirect } from 'next/navigation'

export default function ParametrosPage() {
  redirect('/settings?tab=campanha-sdr')
}
