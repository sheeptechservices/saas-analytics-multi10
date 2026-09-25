/* Raiz da autoridade certificadora da Supabase.
 *
 * Por que isto existe: a Supabase opera CA própria. O pooler apresenta a cadeia
 *
 *   *.pooler.supabase.com  ←  Supabase Intermediate 2021 CA  ←  Supabase Root 2021 CA
 *
 * e essa raiz é autoassinada, então não está na loja de CAs do Node. Sem ela, toda
 * consulta à base do SDR morre com SELF_SIGNED_CERT_IN_CHAIN — foi o que derrubou o
 * módulo em produção em 25/09/2026.
 *
 * A alternativa era `sslmode=no-verify`, que cifra sem autenticar: cobre bisbilhoteiro,
 * não cobre quem se põe no meio do caminho fingindo ser o banco. Fixando a raiz, a
 * verificação volta a valer de verdade — a cadeia é conferida, só que contra a raiz
 * da Supabase em vez da loja pública.
 *
 * Está embutida como texto, e não num arquivo .pem lido em tempo de execução, por
 * dois motivos: o empacotamento do Next não leva junto um arquivo solto que ninguém
 * importa, e ler disco a cada partida acrescenta um modo de falha que não precisa
 * existir. Constante é empacotada por construção.
 *
 * Procedência: capturada do aperto de mão com aws-0-sa-east-1.pooler.supabase.com:5432
 * e conferida contra o certificado publicado no painel da Supabase.
 *   Sujeito/emissor: CN=Supabase Root 2021 CA, O=Supabase Inc
 *   Validade: 2021-04-28 → 2031-04-26
 *   SHA-256: 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:
 *            82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
 *
 * VENCE EM ABRIL DE 2031. Quando a Supabase rodar a raiz, esta constante deixa de
 * fechar a cadeia e o SDR volta a falhar com o mesmo erro — com a mensagem
 * `sdr_db_tls`, que diz para conferir o certificado da fonte. O teste ao lado
 * reprova antes disso, um ano antes do vencimento.
 */
export const CA_SUPABASE = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`

/** Vencimento da raiz acima, para o teste avisar antes de o SDR cair. */
export const CA_SUPABASE_VENCE_EM = Date.UTC(2031, 3, 26, 10, 56, 53)

/* Sufixo inteiro, nunca fim de texto: `evil-supabase.com` e
 * `supabase.com.invasor.net` NÃO são a Supabase, por mais que terminem parecido. */
const DOMINIOS_SUPABASE = ['supabase.com', 'supabase.co']

export function ehHostSupabase(host: string): boolean {
  const limpo = host.trim().toLowerCase().replace(/\.$/, '')
  return DOMINIOS_SUPABASE.some(d => limpo === d || limpo.endsWith('.' + d))
}
