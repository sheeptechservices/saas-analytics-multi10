'use client'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { CampoSenha } from '@/components/CampoSenha'
import { ApiErrorState } from '@/components/ApiErrorState'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field } from '@/components/ui/Input'
import { fetchJson, type TextoDaFalha } from '@/lib/api-error'
import {
  MIN_SENHA,
  MSG_CONFIRMACAO_DIFERENTE,
  textoDaTrocaDeSenha,
  validarNovaSenha,
} from '@/lib/senha'

/* Trocar a própria senha, na aba Perfil de Configurações.
 *
 * Três campos porque a senha atual é obrigatória: sem ela, um navegador logado e
 * deixado aberto trancaria o dono para fora da conta. Quem confere é o servidor
 * (app/api/me/password); o que está aqui é só para a pessoa não mandar um pedido
 * que já se sabe que vai voltar.
 *
 * Os campos são o CampoSenha de sempre — o mesmo do login e da redefinição, com
 * o olho de mostrar/ocultar e o `type="button"` que evita submeter o formulário
 * ao clicar nele. Nenhum <input> novo foi escrito aqui.
 *
 * Sem estilo em linha e sem onMouseEnter/Leave: tudo em classe do design system
 * (.card/.btn/.field vêm de app/globals.css), que é o que faz hover e foco
 * funcionarem também por teclado e por toque. No celular o .btn já nasce com
 * 44px de altura e o olho do CampoSenha carrega .touch-target. */

/** Recusa decidida aqui, antes de pedir qualquer coisa ao servidor. */
function recusaLocal(detalhe: string): TextoDaFalha {
  return { titulo: 'Não foi possível alterar a senha', detalhe, podeTentarDeNovo: false }
}

export function TrocarSenha() {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [falha, setFalha] = useState<TextoDaFalha | null>(null)
  const [pronto, setPronto] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setPronto(false)

    // A confirmação nunca sai daqui: o servidor não tem o que fazer com ela.
    if (nova !== confirmacao) { setFalha(recusaLocal(MSG_CONFIRMACAO_DIFERENTE)); return }
    // Mesma função que lib/senha-troca.ts chama no servidor — a regra é uma só.
    const problema = validarNovaSenha(nova)
    if (problema) { setFalha(recusaLocal(problema)); return }

    setSalvando(true)
    setFalha(null)
    try {
      /* fetchJson, e não `fetch(...).then(r => r.json())`: com o `.then` cru, um
       * 400 vira um objeto `{ error: ... }` que o código seguinte trataria como
       * sucesso — a tela diria "senha alterada" sem nada ter sido alterado. */
      await fetchJson('/api/me/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senhaAtual: atual, novaSenha: nova }),
      })
      setAtual(''); setNova(''); setConfirmacao('')
      setPronto(true)
    } catch (erro) {
      setFalha(textoDaTrocaDeSenha(erro))
    } finally {
      setSalvando(false)
    }
  }

  return (
    /* basis-full: o pai é a linha flex da aba Perfil (formulário + prévia), e
       este cartão ocupa a linha de baixo inteira em vez de virar uma terceira
       coluna estreita. max-w casa com a largura do cartão do perfil. */
    <Card className="animate-slide-up delay-4 basis-full max-w-[520px]">
      <CardHeader
        title="Senha"
        sub={`Confirme a senha atual para trocar. A nova precisa ter pelo menos ${MIN_SENHA} caracteres.`}
      />

      <form onSubmit={enviar} className="flex flex-col gap-[14px]">
        <Field label="Senha atual" htmlFor="senha-atual">
          <CampoSenha
            id="senha-atual"
            value={atual}
            onChange={setAtual}
            required
            autoComplete="current-password"
          />
        </Field>

        <Field label="Nova senha" htmlFor="senha-nova">
          <CampoSenha
            id="senha-nova"
            value={nova}
            onChange={setNova}
            required
            minLength={MIN_SENHA}
            autoComplete="new-password"
          />
        </Field>

        <Field label="Confirmar nova senha" htmlFor="senha-confirmacao">
          <CampoSenha
            id="senha-confirmacao"
            value={confirmacao}
            onChange={setConfirmacao}
            required
            minLength={MIN_SENHA}
            autoComplete="new-password"
          />
        </Field>

        {falha && <ApiErrorState compacto texto={falha} />}

        {pronto && (
          /* `status` e não `alert`: é a confirmação de algo que a pessoa acabou
             de pedir, então o leitor de tela anuncia sem cortar a leitura. */
          <div
            role="status"
            className="flex items-start gap-2 rounded-(--radius-md) border border-(--success-mid) bg-(--success-dim) p-4 text-13 font-medium text-(--success-text)"
          >
            <Check size={14} className="mt-px shrink-0" aria-hidden />
            <span className="max-lg:wrap-anywhere">
              Senha alterada. Ela já vale no próximo login.
            </span>
          </div>
        )}

        <Button type="submit" variant="primary" shape="pill" disabled={salvando} className="self-start">
          {salvando ? 'Salvando…' : 'Alterar senha'}
        </Button>

        {/* Dito na cara, e não escondido: a sessão é um JWT assinado, sem tabela
            de sessão para limpar, então trocar a senha não derruba ninguém que já
            esteja logado. Ver o comentário de app/api/me/password/route.ts. */}
        <p className="text-12 text-muted">
          Trocar a senha não desconecta os aparelhos que já estão logados — a nova senha vale a
          partir do próximo login. Se você suspeita que alguém está usando sua conta, avise o
          suporte para que o acesso seja encerrado.
        </p>
      </form>
    </Card>
  )
}
