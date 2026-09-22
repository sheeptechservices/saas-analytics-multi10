import { timingSafeEqual } from 'crypto'

// Comparação de segredos em tempo constante.
//
// `a !== b` sai no primeiro byte diferente: quem consegue medir o tempo da
// resposta descobre o segredo byte a byte. `timingSafeEqual` compara sempre a
// string inteira — mas lança exceção quando os tamanhos diferem, então o
// tamanho é conferido antes (isso só vaza o comprimento, que o formato do
// segredo já torna público).
//
// Strings vazias de ambos os lados devolvem true: quem chama decide se "sem
// segredo" é aceitável (as rotas de ack recusam antes de chegar aqui).
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const recebido = Buffer.from(a, 'utf8')
  const esperado = Buffer.from(b, 'utf8')
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
}
