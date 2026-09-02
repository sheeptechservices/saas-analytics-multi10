# Pacote de handoff — redesenho Libero (Entregas 0 a 5)

Para o agente com acesso ao repositório. Nada aqui é tela nova: é a consolidação
do que foi especificado e do código de fundação já escrito.

O que existe fora do repositório, e que não se cola em código: os documentos de
entrega (`Entrega 0` a `Entrega 5`) com os quadros de todos os estados, e as
telas parametrizadas (`Login`, `Visão geral`, `Conversas`, `Leads`, `Disparos`).
Use-os como referência visual — eles carregam os valores exatos de cor, altura,
espaçamento e copy de cada estado.

Nomenclatura usada abaixo: **novo** = arquivo/componente que não existe;
**substitui** = arquivo existente reescrito; **reforma** = arquivo existente que
muda de aparência e comportamento mas mantém a assinatura.

---

## 1. Arquivos de código produzidos

Oito arquivos. Todos em português nos comentários, TypeScript estrito, sem
dependência nova de npm.

| Destino no projeto | Situação | Linhas | O que é |
|---|---|---|---|
| `app/globals.css` | **substitui** | 435 | Bloco `@theme` completo: 12 neutros, papéis de superfície e texto, 4 famílias semânticas + quiet, estados de domínio, 15 variáveis de marca com fallback, superfície de IA, escala tipográfica de 9 tamanhos, espaçamento base 4, densidade em dois modos, 3 radius, 3 níveis de elevação, z-index, motion. Mais `@layer base`, os 4 keyframes permitidos e o bloco `prefers-reduced-motion`. **Única fonte de hexadecimal do projeto.** |
| `lib/brand.ts` | **substitui — ver conflito na seção 2** | 382 | Cor de marca do tenant: parse de hex, contraste WCAG 2.1 real, conversão sRGB↔Oklch com redução de croma por bisseção, escala de 10 tons, resolução dos tokens finais (`action`, `contrast`, `subtle`, `onSubtle`, `focus`) e validação para o formulário de Marca. |
| `lib/motion-controller.ts` | **novo** | 198 | Um único `requestAnimationFrame` por tela. Escreve valores no DOM por ref (variável CSS para geometria, `textContent` para número); o React re-renderiza duas vezes, não a 60fps. É o que torna a proibição de estilo inline aplicável sem exceção. |
| `lib/animation-gate.ts` | **novo** | 137 | Regra de "animar uma vez por sessão e por período do dia", com período sempre calculado em `America/Sao_Paulo` e a noite pertencendo ao dia em que começou. Tolerante a armazenamento bloqueado (padrão seguro = estado final). |
| `app/animation-gate-script.ts` | **novo** | 65 | A mesma decisão, sem imports, para rodar síncrona no `<head>` antes da primeira pintura. Exporta `ANIMATION_GATE_SCRIPT`; monta em `app/layout.tsx`. Sem isso o gráfico pinta no estado final e volta ao início da animação. |
| `lib/hooks/useChartMotion.ts` | **novo** | 70 | `useEntranceMotion()` (lê `data-animate`) e `useValueMorph()` (300ms do valor antigo ao novo). Os dois únicos comportamentos de movimento permitidos em gráfico. |
| `eslint.config.mjs` | **substitui** | 156 | As 4 regras do redesenho com **severidade por caminho**: arquivo migrado é erro, legado é aviso. A lista `MIGRATED` cresce por entrega. |
| `components/settings/BrandColorField.tsx` | **novo** | 133 | Campo de cor primária que mostra as duas amostras quando a variante de ação difere da cor informada (marca no logo, contraste aprovado no botão), com as mensagens de validação em pt-BR. |

### O que falta e não foi escrito como código
Estes ficaram só como especificação nos documentos, deliberadamente — dependem
de decisões suas sobre estrutura de pastas:

- `lib/animation-gate.test.ts` — o comentário de `animation-gate-script.ts`
  referencia este teste. Ele **não existe**; precisa ser escrito, cobrindo as
  duas implementações com as mesmas datas de fronteira (04:59, 05:00, 11:59,
  12:00, 17:59, 18:00, 00:30).
- `lib/format.ts` — reforma prevista na Entrega 4 (número tabular pt-BR, data
  curta `31/08 09:12`, rótulo de campo vazio em um só lugar). Especificado, não
  escrito.
- `stores/whiteLabelStore.ts` — aparece em `MIGRATED` porque perde a
  responsabilidade de calcular cor. Ver seção 2: no repositório isso já
  aconteceu.
- Os componentes da seção 3. Nenhum foi escrito como `.tsx`.

---

## 2. AVISO DE CONFLITO — `lib/brand.ts`

**Leia isto antes de sobrescrever o arquivo.**

Situação: outro agente já modificou `lib/brand.ts` no repositório. Naquela
versão, o cálculo das variáveis de marca saiu do store do zustand e foi para
`lib/brand.ts`, e o layout de servidor imprime as variáveis como CSS no HTML,
eliminando o flash de marca.

**Não sobrescreva.** As duas versões resolvem problemas diferentes e ambas
precisam sobreviver. A versão do repositório ganha na arquitetura; a minha ganha
na correção de cor.

### O que da versão do repositório fica, sem discussão

- **A impressão das variáveis no HTML do servidor.** Isso resolve o flash de
  marca, que é um defeito visível ao usuário. `applyBrandTokens()` na minha
  versão escreve no `documentElement` no cliente, o que é exatamente o que
  causa o flash. Mantenha o caminho do servidor como principal.
- **A saída do cálculo do store do zustand.** Correta e alinhada com a Entrega
  1: o branding é resolvido no servidor a partir do slug, e o `whiteLabelStore`
  deixa de decidir cor.
- **A assinatura que o layout de servidor consome.** Se ela difere da minha,
  a minha se adapta — não o contrário.

### O que da minha versão precisa sobreviver

Estas são as partes que corrigem defeitos reais, e nenhuma delas conflita com
a integração de servidor: são funções puras, sem DOM.

1. **`contrastRatio` / `relativeLuminance` / `pickAccessibleText`** — contraste
   WCAG 2.1 real, mínimo 4,5:1. Substitui a decisão por luminância YIQ que
   existia nas duas funções antigas. É o que impede texto branco ilegível sobre
   marca amarela clara. **Crítico.**
2. **`rgbToOklch` / `oklchToRgb` / `generateBrandScale`** — a escala de 10 tons
   em Oklch, com luminância fixa por degrau e croma reduzido por bisseção até
   caber no gamut sRGB. É o que mantém a escala coerente para marca vermelha,
   verde, roxa, preta ou amarela. **Crítico** se o produto tem tenants com marca
   fora do azul.
3. **A regra do degrau aprovado mais próximo** em `resolveBrandTokens`: quando a
   cor recebida não passa AA com tinta nem com papel, a variante de ação troca
   pelo degrau aprovado **mais próximo em luminância**, não pelo primeiro de uma
   ordem fixa. Isso mantém o desvio mínimo, para que a diferença pareça ajuste
   de contraste e não outra cor. **Crítico** — é a diferença entre "o botão
   ficou um pouco mais escuro" e "o botão ficou de outra cor".
4. **`validateBrandColor`** com as mensagens em pt-BR — consumido por
   `BrandColorField.tsx`. Sem ele, o campo de Marca não tem o que exibir.
5. **Os 5 tokens derivados** (`action`, `contrast`, `subtle`, `onSubtle`,
   `focus`) como conceito. Se a versão do repositório expõe menos que isso, os
   componentes das cinco entregas não têm o que ler: eles nunca escrevem
   `#fff` sobre a marca, leem `--brand-contrast`.

### O que da minha versão pode ser descartado

- **`applyBrandTokens()`** — a escrita no `documentElement` no cliente. Foi
  escrita como "único ponto de escrita" justamente porque o repositório não
  tinha o caminho de servidor. Agora tem. **Descarte**, ou mantenha apenas como
  caminho de atualização ao vivo na tela de Marca (pré-visualização enquanto o
  usuário digita), nunca no boot.
- **Os valores de fallback das 15 variáveis em `globals.css`** podem ficar, mas
  perdem a função de evitar flash — passam a ser só rede de segurança para
  render sem tenant resolvido.

### Reconciliação recomendada, em ordem

1. Leia a versão do repositório e identifique a função que o layout de servidor
   chama (provavelmente algo como `brandVars(primary)` ou `getBrandCss`).
2. Cole em `lib/brand.ts` as funções puras da minha versão: parse/hex, WCAG,
   Oklch, escala, `resolveBrandTokens`, `validateBrandColor`. Nenhuma toca no
   DOM.
3. Reescreva a função que o servidor chama para que ela produza o CSS **a partir
   de `resolveBrandTokens()`**, em vez de do cálculo antigo. O contrato externo
   não muda; a matemática por trás dele passa a ser a correta.
4. Remova `applyBrandTokens` do caminho de boot.
5. **Valide com quatro cores antes de seguir:** `#00224F` (azul escuro),
   `#FFE066` (amarelo claro — o caso que quebra YIQ), `#D93025` (vermelho
   saturado) e `#111111` (quase preto). Em todas, `--brand-contrast` sobre
   `--brand-action` precisa dar ≥ 4,5:1, e a escala de 10 tons precisa ter ritmo
   perceptualmente igual.

---

## 3. Inventário de componentes

38 componentes nas cinco entregas. Caminhos sugeridos, ajuste à convenção do
repositório. "Telas" refere-se às entregas em que o componente aparece.

### Fundação e casca (Entregas 1 e 2)

| Componente | Destino | Situação | Telas | Estados | Dependência de dado |
|---|---|---|---|---|---|
| `BrandMark` | `components/brand/BrandMark.tsx` | novo | Login, casca | horizontal, quadrado, iniciais sobre `--brand-action`, plataforma neutro | `tenants.logo_url` em **duas proporções** (hoje campo único) |
| `AuthCard` | `components/auth/AuthCard.tsx` | novo | Login | padrão, foco, erro, carregando marca, enviando | branding resolvido no servidor |
| `Input` | `components/ui/Input.tsx` | reforma | Login, Conversas, Disparos | padrão, foco, erro, desabilitado, com máscara | — |
| `Button` | `components/ui/Button.tsx` + classes `.btn` em `globals.css` | reforma | todas | primário, secundário, ghost, carregando, desabilitado **com motivo**, destrutivo | permissão por ação (`requireRole`) para o estado desabilitado explicado |
| `InlineAlert` | `components/ui/InlineAlert.tsx` | novo | Login, Conversas, Disparos | danger, warning, success, info | — |
| `IdentityRow` | `components/auth/IdentityRow.tsx` | novo | Login | identificado, com ação Trocar | — |
| `PlatformFooter` | `components/layout/PlatformFooter.tsx` | novo | Login | único (faixa fixa entre tenants) | — |
| `Sidebar` | `components/layout/Sidebar.tsx` | reforma | todas | item ativo, hover, colapsado, mobile | contagem opcional por destino |
| `DensityToggle` | `components/layout/DensityToggle.tsx` | novo | topbar + perfil | compacto, confortável | preferência persistida no perfil |
| `EmptyState` / `ErrorState` | `components/ui/States.tsx` | novo | todas | vazio, erro com código técnico, sem permissão | — |
| `SkeletonTable` / `SkeletonCampaignList` | `components/Skeleton.tsx` | reforma | Leads, Conversas, Disparos | por geometria da tabela ativa | — |

### Visão geral (Entrega 2)

| Componente | Destino | Situação | Estados | Dependência de dado |
|---|---|---|---|---|
| `BandHeader` | `components/dashboard/BandHeader.tsx` | novo | único | — |
| `KpiCard` | `components/dashboard/KpiCard.tsx` | reforma | com dado, sem base de comparação, zero, carregando, erro | **série de 7 pontos por KPI** (não existe); `kpisChange` já existe e está subutilizado |
| `FunnelList` | `components/dashboard/FunnelList.tsx` | **substitui `FunnelChart`** | com dado, etapa zerada, sem dado, carregando | destino de drill-down por etapa → **`leads.stage_key`** |
| `DonutChart` | `components/dashboard/DonutChart.tsx` | reforma | com dado, cobertura parcial declarada, sem dado | cobertura (`n de N contatos`) |
| `TelemetryGrid` | `components/dashboard/TelemetryGrid.tsx` | novo | conectado, degradado, sem dado | — |
| `SourceStatusRow` | `components/dashboard/SourceStatusRow.tsx` | novo | conectada, com erro, nunca sincronizada, sincronizando | **`lastSyncAt` por fonte** (hoje é único e mente) |
| `PeriodSelector` | `components/ui/Segmented.tsx` | reforma | 4 opções, ativo | — |

### Conversas (Entrega 3)

| Componente | Destino | Situação | Estados | Dependência de dado |
|---|---|---|---|---|
| `ConversationList` | `components/conversations/ConversationList.tsx` | reforma | não lida, lida, assumida, selecionada, carregando, vazia | não lida **no servidor** (hoje em `localStorage`) |
| `SavedViews` | `components/conversations/SavedViews.tsx` | novo | 4 visões com contagem, ativa | **contagem agregada por visão** no servidor |
| `MessageBubble` | `components/conversations/MessageBubble.tsx` | reforma | lead, automático, humano, enviando, falhou | confirmação de leitura por mensagem |
| `DayDivider` | `components/conversations/DayDivider.tsx` | reforma | único | — |
| `WindowIndicator` | `components/conversations/WindowIndicator.tsx` | novo | dentro, últimos 15 min, fechada com horário | **`inWindow` + `windowExpiresAt` no item da lista** (hoje só na thread) |
| `Composer` | `components/conversations/Composer.tsx` | reforma | livre, template, foco, enviando, erro, sem permissão | `inWindow`; rascunho por conversa |
| `TemplatePicker` | `components/conversations/TemplatePicker.tsx` | novo | lista, variáveis preenchidas, pré-visualização, nenhum aprovado | **`/api/sdr/templates` com idioma, categoria e variáveis** |
| `AiContextPanel` | `components/conversations/AiContextPanel.tsx` | novo | coluna, drawer, processando, sem dado | 6 campos inativos (seção 5) |
| `TakeoverControl` | `components/conversations/TakeoverControl.tsx` | novo | livre, assumida por mim, assumida por outro, devolvendo | **`conversations.assigned_to_user_id` + `assigned_at`** e o silenciamento do SDR |
| `AuthorshipBadge` | `components/conversations/AuthorshipBadge.tsx` | novo | com persona, sem persona configurada | persona do SDR |

### Leads (Entrega 4)

| Componente | Destino | Situação | Estados | Dependência de dado |
|---|---|---|---|---|
| `LeadsTable` | `components/leads/LeadsTable.tsx` | novo | com dado, carregando, vazio, erro, sem resultado, densidade ×2 | `created_at` no payload |
| `EmptyCell` | `components/ui/EmptyCell.tsx` | novo | 5 rótulos (sem empresa, sem origem, sem interação, sem nome, sem negócio) | valor nulo na linha |
| `CoverageNote` | `components/ui/CoverageNote.tsx` | novo | percentual, indisponível | **`count(*) filter (where col is null)`** no servidor |
| `SortableHeader` | `components/ui/SortableHeader.tsx` | novo | não ordenado, asc, desc, não ordenável | **whitelist de ordenação** no servidor |
| `FilterBar` | `components/leads/FilterBar.tsx` | novo | sem filtro, com chips aplicados, buscando (debounce 350 ms) | **facetas com contagem** |
| `ColumnPicker` | `components/leads/ColumnPicker.tsx` | novo | aberto, fechado, coluna indisponível | escolha persistida por usuário |
| `BulkActionBar` | `components/leads/BulkActionBar.tsx` | novo | parcial, página, filtro inteiro, sem permissão | **ids por filtro** (seção 5) |
| `Pagination` | `components/ui/Pagination.tsx` | reforma | primeira, meio, última, uma só página | teto de 50 do servidor |
| `StatusBadge` | `components/ui/StatusBadge.tsx` | reforma | 5 famílias + valor desconhecido preservado | — |
| `SearchField` | `components/ui/SearchField.tsx` | reforma | vazio, digitando, buscando, com contagem | — |

### Disparos (Entrega 5)

| Componente | Destino | Situação | Estados | Dependência de dado |
|---|---|---|---|---|
| `Stepper` | `components/blast/Stepper.tsx` | reforma | 3 passos × (futuro, ativo, concluído) | — |
| `RecipientPicker` | `components/blast/RecipientPicker.tsx` | novo | base, planilha, manual; **com e sem ids por filtro** | **ids por filtro** — define qual dos dois comportamentos existe |
| `SelectionCounter` | `components/blast/SelectionCounter.tsx` | novo | por página, por filtro, planilha, manual, zero | contagem de escopo |
| `ImportSummary` | `components/blast/ImportSummary.tsx` | reforma | importados, duplicados, ignorados, suspeitos | normalização E.164 no servidor |
| `TemplatePreview` | `components/blast/TemplatePreview.tsx` | novo | com variáveis, com fallback, nenhum template aprovado | **`renderMessage` por variável** (defeito conhecido) |
| `ReviewPanel` | `components/blast/ReviewPanel.tsx` | novo | 6 linhas de revisão | contagem confirmada (selecionados − ignorados) |
| `ConfirmGate` | `components/blast/ConfirmGate.tsx` | novo | desarmado, armado, enviando, concluído, parcial, falhou | permissão por ação |
| `CampaignRow` | `components/blast/CampaignRow.tsx` | reforma | em andamento, concluído, erro, expandido | status agregado (já existe) |
| `RecipientTable` | `components/blast/RecipientTable.tsx` | novo | 5 status × (com motivo, sem motivo) | **motivo traduzido** do código YCloud |
| `StatusSegments` | `components/blast/StatusSegments.tsx` | novo | 5 segmentos proporcionais com legenda contada | — |

---

## 4. Ordem de integração

Sequência obrigatória. Cada passo tem um critério de validação que precisa
passar antes do seguinte — a maioria das armadilhas aqui só aparece se um passo
for pulado.

### Passo 1 — `app/globals.css`
Substitua o arquivo. É a base de tudo; nada mais funciona antes.

Junto com ele, **troque a fonte no `app/layout.tsx`**: sai Manrope (não Poppins
nem Nunito — ver a correção de 02/09/2026 na seção 6), entram Inter e JetBrains
Mono declaradas com `variable`, senão `--font-sans` cai em `system-ui` sem
reclamar. Duas correções de comentário no próprio arquivo entram aqui: a seção 5
cita `applyBrandTokens()`, que a seção 2 manda descartar, e a seção 9 chama
compacto de "padrão do operador" quando quem decide o padrão é o papel do
usuário, no servidor (`lib/density.ts`).

**Valide:** o build do Tailwind v4 passa; `bg-(--color-surface-page)` e
`text-body` resolvem; `data-density="compact"` no `<html>` muda `--row-h` de 48
para 36 no inspetor; a fonte renderizada é Inter, não a de reserva do sistema.
Nenhuma tela precisa estar migrada ainda.

### Passo 2 — `lib/brand.ts` (reconciliação da seção 2)
Não sobrescreva. Siga os cinco passos da reconciliação.

**Valide:** as quatro cores de teste (`#00224F`, `#FFE066`, `#D93025`,
`#111111`) produzem `--brand-contrast` com ≥ 4,5:1 sobre `--brand-action`; o
HTML do servidor continua trazendo as variáveis impressas; **não há flash de
marca** ao recarregar. Se o flash voltou, `applyBrandTokens` ficou no boot.

### Passo 3 — `eslint.config.mjs`
Entre com a lista `MIGRATED` **vazia ou só com os arquivos de fundação**. Se
entrar com a lista cheia enquanto as telas ainda são as antigas, o CI quebra em
massa e a regra é desligada por inteiro — foi o que a severidade por caminho
existe para evitar.

**Valide:** `next lint` roda; os 2.338 avisos continuam avisos; os arquivos de
fundação são erro e estão limpos. O número total de avisos não deve subir.

### Passo 4 — motion (`animation-gate.ts`, `animation-gate-script.ts`, `motion-controller.ts`, `useChartMotion.ts`)
Os quatro juntos; separados não fazem sentido. Monte
`ANIMATION_GATE_SCRIPT` no `<head>` de `app/layout.tsx`. **Escreva
`lib/animation-gate.test.ts` neste passo** — as duas implementações da regra
divergem silenciosamente sem ele.

**Valide:** `data-animate` aparece no `<html>` antes da primeira pintura;
recarregar duas vezes na mesma sessão anima só a primeira; com
`prefers-reduced-motion` nada anima e os valores saem finais; em modo privado
nada anima e nada quebra; o teste cobre as 7 datas de fronteira.

### Passo 5 — `BrandColorField.tsx` + tela de Marca
Primeiro consumidor real dos tokens. Pequeno, isolado, e prova a cadeia inteira.

**Valide:** digitar `#FFE066` mostra as duas amostras e a mensagem de contraste;
o botão primário na pré-visualização usa a variante aprovada, não a cor digitada.

### Passo 6 — casca (`Sidebar`, topbar, `DensityToggle`, `EmptyState`/`ErrorState`, `Button`, `Input`, `InlineAlert`)
A casca é compartilhada por todas as telas. Migrar tela antes da casca obriga a
migrar duas vezes.

**Valide:** a densidade troca a casca inteira sem prop passada a nenhum
componente; nenhum `#hex` nos arquivos tocados; adicione-os a `MIGRATED` e o
lint fica em erro zero neles.

### Passo 7 — Entrega 1, Login
Primeira tela completa. Depende da resolução de branding no servidor por slug.

**Valide:** os 8 estados do documento da Entrega 1; nenhum flash de marca; a
faixa da plataforma aparece igual em todo tenant.

### Passo 8 — Entrega 2, Visão geral
Primeiro consumo do `motion-controller`.

**Valide:** entrada dentro do teto de 680 ms; um só `requestAnimationFrame`
ativo no profiler; trocar período faz morph de 300 ms **sem replay** da entrada;
o funil sem `stage_key` mostra as linhas sem drill-down em vez de link morto.

### Passo 9 — Entrega 3, Conversas
Depende dos campos de atribuição. **Se `assigned_to_user_id` e o silenciamento
do SDR não existirem, `TakeoverControl` não entra** — assumir sem silenciar o
agente produz o humano e a IA respondendo em paralelo, que é o pior defeito
possível nesta tela. Migre o resto e deixe o controle fora.

**Valide:** os estados da Entrega 3; a janela de 24 h muda o composer sem
recarga e preserva o rascunho; o painel de IA vira drawer abaixo de 1280 px.

### Passo 10 — Entrega 4, Leads
**Antes desta tela, decida a rota de ids por filtro** (seção 5, item 1). A
decisão muda o passo 1 de Disparos.

**Valide:** cobertura de nulos vem do servidor, não contada sobre a página de 50;
ordenação só nas colunas da whitelist; campo vazio idêntico nas 5 ocorrências;
seleção sobrevive à troca de página.

### Passo 11 — Entrega 5, Disparos
Último, porque o passo 1 **é** a tabela de Leads. Habilite o comportamento de
seleção conforme a decisão do passo 10.

**Valide:** o botão de disparo não arma sem aceite e sem a quantidade digitada;
o estado de n8n em 502 mostra a campanha gravada e oferece reenvio **por
destinatário pendente**, nunca da lista inteira; nenhum caminho envia sem
template aprovado.

### Passo 12 — fechamento do lint
Com todas as telas em `MIGRATED`, promova as três regras a erro global e remova
o bloco de legado.

**Valide:** `next lint` em zero. Se sobrar aviso, sobrou arquivo não migrado —
é o inventário de dívida restante.

---

## 5. Dependências de back-end — lista consolidada

Tudo o que ficou pendente nas cinco entregas. Ordenado por quanto bloqueia.

### Bloqueiam componente inteiro

| # | Campo / rota necessária | Componente afetado | Depende de |
|---|---|---|---|
| 1 | **`POST /api/sdr/leads/ids`** — ids do filtro inteiro | `BulkActionBar` (E4), `RecipientPicker` (E5) | back-end. Sem ela, seleção não passa da página atual em nenhuma das duas telas |
| 2 | **`leads.stage_key`** por lead | `FunnelList` drill-down (E2), destinos de Leads (E4) | modelagem. O funil vive agregado em `funnel_snapshots`; 5 dos 6 destinos abrem com recorte parcial |
| 3 | **`conversations.assigned_to_user_id` + `assigned_at`** | `TakeoverControl` (E3) | migração de schema |
| 4 | **Silenciar o SDR por conversa** (contrato consultado pelo n8n antes de enviar) | `TakeoverControl` (E3) | n8n + back-end. Sem isso o controle **não deve entrar** |
| 5 | **`created_at` no payload de `/api/sdr/leads`** | coluna Recebido em, filtro por período, rota de drill-down (E4) | a query já ordena por ele e não o devolve |
| 6 | **`/api/sdr/templates` com idioma, categoria, status e variáveis com origem** | `TemplatePicker` (E3), `TemplatePreview` (E5) | YCloud + back-end |
| 7 | **`renderMessage` por variável** (hoje uma substituição global troca toda variável pelo primeiro nome) | `TemplatePreview` (E5) | back-end. Defeito real: template com 2 variáveis sai errado em 100% das mensagens |

### Degradam o componente, que funciona declarando o limite

| # | Campo / rota | Componente | Nota |
|---|---|---|---|
| 8 | `lastSyncAt` **por fonte** | `SourceStatusRow` (E2) | hoje é único e mostra "Nunca" com o WhatsApp funcionando |
| 9 | Série de **7 pontos por KPI** | `KpiCard` (E2) | só existe `whatsapp.daily`; agregação por KPI de negócio não existe |
| 10 | Rota de **reautenticação por integração** | `SourceStatusRow` (E2) | hoje o botão só refaz o fetch, o que não resolve credencial expirada |
| 11 | Marcador de **não lida no servidor** | `ConversationList` (E3) | hoje em `localStorage`, não acompanha o usuário entre dispositivos |
| 12 | **Contagem agregada por visão salva** | `SavedViews` (E3) | contar no cliente sobre 50 de 1.284 dá número errado |
| 13 | `inWindow` + `windowExpiresAt` **no item da lista** | `WindowIndicator` (E3) | já existem na thread |
| 14 | Confirmação de leitura **por mensagem** | `MessageBubble` (E3) | o webhook do YCloud já traz o evento; falta persistir |
| 15 | **Whitelist de ordenação** no servidor | `SortableHeader` (E4) | com nulos por último nos dois sentidos |
| 16 | **Facetas de filtro com contagem** (origem, status, + nulos) | `FilterBar` (E4) | sem isso o chip abre lista vazia ou inventada |
| 17 | **Cobertura por coluna** (`count` de nulos) | `CoverageNote` (E4) | na mesma resposta; calcular sobre a página dá número errado |
| 18 | `last_interaction_at` por lead | coluna opcional (E4) | existe em `contacts`, por telefone |
| 19 | **Lotes acima de `MAX_LEADS = 1000`**, uma campanha por lote | `RecipientPicker`, `CampaignRow` (E5) | senão o histórico perde rastreabilidade |
| 20 | **Idempotência por destinatário** no reenvio | `RecipientTable` (E5) | sem chave, reenvio após 502 duplica mensagem entregue |
| 21 | **Tradução dos códigos de erro do YCloud**, no servidor | `RecipientTable` (E5) | código sem tradução aparece cru, nunca "erro desconhecido" |
| 22 | `reconcile` **fora do GET** da lista + paginação em `/api/sdr/blast/campaigns` | `CampaignRow` (E5) | hoje roda a cada abertura e vira gargalo |
| 23 | **Ack por lote** do n8n | `ConfirmGate` (E5) | sem ele a barra só conta entrega à fila, não envio real |
| 24 | **Rota de exportação** de seleção | `BulkActionBar` (E4) | não existe; ação fica indisponível declarada |
| 25 | **Permissão por ação** antes do passo 3 | `Button`, `ConfirmGate` (E5) | `requireRole` já existe no servidor; falta expor à interface |

### Infraestrutura (Entrega 1)

| # | Item | Depende de |
|---|---|---|
| 26 | `middleware.ts` lendo o Host e injetando `tenantId` + branding | back-end |
| 27 | `tenants.slug` com regex e palavras reservadas | migração |
| 28 | DNS wildcard `*.libero.app` + certificado curinga | infra/Vercel |
| 29 | `tenants.logo_url` em **duas proporções** | migração |
| 30 | Erro distinguível: credencial inválida × conta sem vínculo | back-end. Sem isso a tela de conta sem acesso não existe |
| 31 | Contador de tentativas por e-mail e IP | back-end. Sem isso sai a segunda linha do alerta |

### Campos inativos por desenho (especificados, desligados)

Todos aparecem no seu componente como indisponíveis com o campo declarado.
Nenhum é derivado no cliente.

- **Conversas:** `intent`, `objection`, `temperature`, `summary`,
  `next_action`, `confidence`
- **Leads:** `stage_key`, `owner_user_id`, `last_campaign`, `score`,
  `lost_reason`, `tags`
- **Disparos:** `scheduled_at`, `paused_at`, teste de envio unitário,
  `quiet_hours`, `template_price`

Agendamento (`scheduled_at`) é o pedido mais provável depois da Entrega 5. Fica
fora até existir fila com hora marcada no n8n.

---

## 6. Tokens × legado — guia de migração dos 2.338 avisos

408 avisos de hexadecimal literal em `.tsx` e 1.652 de estilo inline. A tabela
abaixo é para migração arquivo por arquivo: procure o valor antigo, troque pelo
token.

### Neutros — os valores que aparecem mais

| Valor antigo no legado | Token | Utilitário Tailwind |
|---|---|---|
| `#fff`, `#ffffff`, `white` | `--color-neutral-0` | `bg-neutral-0`, `text-neutral-0` |
| `#fafafa`, `#fafbfc`, `#f9fafb` | `--color-neutral-25` → `--color-surface-hover` | `bg-surface-hover` |
| `#f4f6f8`, `#f5f5f5`, `#f3f4f6`, `#f9f9f9` | `--color-neutral-50` → `--color-surface-page` | `bg-surface-page` |
| `#e9ecf0`, `#eee`, `#ededed`, `#f0f0f0` | `--color-neutral-100` → `--color-surface-sunken` | `bg-surface-sunken` |
| `#dce0e6`, `#ddd`, `#e5e7eb`, `#e0e0e0` | `--color-neutral-200` → `--color-border-hairline` | `border-border-hairline` |
| `#c3c9d2`, `#ccc`, `#d1d5db` | `--color-neutral-300` → `--color-border-strong` | `border-border-strong` |
| `#98a1ae`, `#999`, `#9ca3af` | `--color-neutral-400` → `--color-text-muted` | `text-text-muted` |
| `#6b7482`, `#666`, `#6b7280`, `#71717a` | `--color-neutral-500` | `text-neutral-500` |
| `#4c5461`, `#555`, `#4b5563` | `--color-neutral-600` → `--color-text-secondary` | `text-text-secondary` |
| `#343b45`, `#333`, `#374151` | `--color-neutral-700` | `text-neutral-700` |
| `#22272e`, `#222`, `#1f2937` | `--color-neutral-800` → `--color-ai-surface` | `bg-ai-surface` |
| `#14181d`, `#111`, `#000`, `black`, `#111827` | `--color-neutral-900` → `--color-text-primary` | `text-text-primary` |

Regra ao decidir: se o valor é **texto**, use o papel (`text-primary`,
`text-secondary`, `text-muted`); se é **superfície**, use `surface-*`; se é
**borda**, use `border-*`. Vá ao neutro numerado só quando nenhum papel servir.

### Semânticos — nunca herdam a cor da marca

| Valor antigo | Token |
|---|---|
| verdes de sucesso (`#10b981`, `#22c55e`, `#16a34a`, `#dcfce7`) | `--color-success-bg` / `-border` / `-text` / `-solid` |
| amarelos e laranjas de aviso (`#f59e0b`, `#fbbf24`, `#fef3c7`, `#f97316`) | `--color-warning-*` |
| vermelhos de erro (`#ef4444`, `#dc2626`, `#fee2e2`, `#f87171`) | `--color-danger-*` |
| azuis informativos (`#3b82f6`, `#2563eb`, `#dbeafe`, `#60a5fa`) | `--color-info-*` |
| cinzas de estado sem carga (rascunho, frio, desconectado) | `--color-quiet-*` |

Estados de domínio já vêm mapeados: use `--state-lead-active`,
`--state-conv-in-window`, `--state-blast-failed`, `--state-campaign-paused`,
`--state-integration-error` etc., em vez de escolher a família na chamada. São 17
mapeamentos prontos no `globals.css`.

### Marca — apenas 4 usos, e nunca cor fixa por cima

| Valor antigo | Token |
|---|---|
| `primaryColor` do store, aplicado direto como `background` | `--brand-action` |
| `#fff` **fixo** sobre a cor da marca | `--brand-contrast` (**nunca** hardcode) |
| fundo tintado do item ativo (`rgba(primary, .1)`, `#eff6ff`) | `--brand-subtle` |
| texto sobre esse fundo | `--brand-on-subtle` |
| `outline`/`box-shadow` de foco com a cor da marca | `--brand-focus` |

Se um arquivo legado usa a marca em algo que **não** é item ativo de navegação,
botão primário, anel de foco ou logo, o uso está errado: troque por neutro ou
por semântico, não por token de marca.

### Superfície de IA

Blocos escuros dentro de produto claro. `--color-ai-surface`,
`-raised`, `-border`, `-text`, `-text-muted` e `--color-ai-accent` (só
indicador de atividade). Não é tema escuro e não herda a marca.

### Tipografia — as classes arbitrárias saem

| Antigo | Token |
|---|---|
| `text-[11px]`, `fontSize: 11` | `text-11` (já traz `line-height` e `letter-spacing` de rótulo) |
| `text-xs`, `text-[12px]` | `text-12` |
| `text-[13px]` | `text-13` |
| `text-sm`, `text-[14px]` | `text-14` |
| `text-[15px]` | `text-15` |
| `text-lg`, `text-[18px]` | `text-18` |
| `text-xl`, `text-[22px]` | `text-22` |
| `text-3xl`, `text-[28px]` | `text-28` |
| `text-4xl`, `text-[36px]` | `text-36` |
| corpo que deve seguir a densidade | `text-body` |

`font-sans` e `font-mono` já apontam para Inter e JetBrains Mono. Remova toda
declaração de família nos componentes.

> **Correção registrada em 02/09/2026 — a substituição é de Manrope.**
>
> A especificação do redesenho foi escrita assumindo que o app usava Poppins e
> Nunito. Não usa: `app/layout.tsx` carrega **Manrope** por `next/font/google`,
> pesos 400 a 800, aplicada por `className` no `<body>`. Alguém trocou a fonte
> entre a especificação e hoje. A decisão de ir para Inter e JetBrains Mono
> continua valendo — o que muda é o ponto de partida da troca.
>
> Consequência mecânica, no Passo 1 e não no Passo 6: hoje **não existe variável
> CSS de fonte no projeto**, porque a Manrope entra por `className`. O
> `globals.css` novo lê `var(--font-inter)` e `var(--font-jetbrains-mono)`, que
> só passam a existir se as fontes forem declaradas com `variable` em
> `next/font` e a variável for pendurada no `<html>`. Sem isso, `--font-sans`
> cai na cadeia de reserva e o produto inteiro sai em `system-ui` — sem erro de
> build, sem aviso de lint, só a tipografia errada em toda tela.
>
> JetBrains Mono não é carregada hoje em lugar nenhum.

### Forma, elevação e espaçamento

| Antigo | Token |
|---|---|
| `rounded`, `rounded-md`, `rounded-lg`, `border-radius: 6px/10px/12px` | `--radius-control` (4px) em controle, tabela, badge |
| `rounded-xl`, `rounded-2xl`, `16px` em card | `--radius-panel` (8px) |
| `rounded-full` em avatar e pill | `--radius-pill` |
| `rounded-full` em **botão ou chip** | ❌ `--radius-control`. Pílula de raio 99 sai do produto |
| `shadow-sm`, `shadow`, `shadow-md` em card | `--shadow-card` (borda nítida, sem sombra difusa) |
| `shadow-lg`, `shadow-xl` em menu/modal/drawer/toast | `--shadow-floating` |
| qualquer sombra em elemento estático | `--shadow-base` (`none`) |
| `p-4`, `gap-3`, `mt-6` com valores fora da base 4 | `--spacing-1..16` |
| padding de card | `--spacing-card-y` / `--spacing-card-x` (seguem a densidade) |
| gutter de página | `--spacing-gutter` |
| altura fixa de linha de tabela | `--height-row` |
| altura fixa de input/botão | `--height-control` |

### Motion — o que substitui o quê

| Antigo | Token / caminho |
|---|---|
| `transition: all 0.2s`, `0.3s`, `ease-in-out` | `--duration-hover/base/panel` + `--ease-standard` |
| `transition: all` | ❌ sempre propriedade explícita |
| `scale()`, `bounce`, `spring`, qualquer coisa acima de 250 ms | ❌ removido. Exceção única: morph de valor, 300 ms |
| shimmer com gradiente animado | `animate-skeleton` (pulso de opacidade, 1,2 s) |
| spinner de carregamento em gráfico | `animate-ai-indeterminate` (barra de 2 px) |
| entrada de item de lista | `animate-enter-item` (4 px + opacidade) |
| entrada de painel/drawer | `animate-enter-panel` (8 px + opacidade) |
| animação de número em JS por `setState` a 60 fps | `lib/motion-controller.ts` (ref, um só rAF) |
| `!important` para desligar animação | ❌ os tokens de duração vão a zero sob `prefers-reduced-motion` |

### Z-index

`--z-base/raised/header/drawer/overlay/modal/toast` (0, 10, 100, 200, 300, 400,
500). Todo `z-50`, `z-[9999]` e `zIndex: 100` do legado entra em um destes sete.

### Os 1.652 avisos de estilo inline — as três saídas

1. **Valor estático** → classe Tailwind com token. Cobre a grande maioria.
2. **Valor calculado em tempo de render** (largura de barra, `strokeDashoffset`,
   posição) → variável CSS declarada no componente, consumida em classe
   arbitrária (`w-[var(--v)]`, `[stroke-dashoffset:var(--v)]`) e escrita por
   ref. É para isso que `lib/motion-controller.ts` existe.
3. **Hover, foco e estado escritos em JS** (`onMouseEnter` mexendo em
   `e.currentTarget.style`) → `:hover`, `:focus-visible`, `data-*` em CSS. A
   regra 3 do lint pega esses; handlers de mouse ficam só para gesto real
   (arrastar, desenhar, medir).

Não existe quarta saída. Se um caso não cabe nas três, é sinal de que o
componente precisa de uma variável CSS nova declarada nele — não de uma exceção
na regra.

---

## Ordem de leitura recomendada dos documentos

`Entrega 0 - Tokens` (o sistema inteiro) → `Entrega 1 - Login` →
`Entrega 2 - Visão geral` → `Entrega 3 - Conversas` →
`Entrega 4 - Leads` → `Entrega 5 - Disparos`.

Cada um traz, no fim, a lista de arquivos legados com esforço por arquivo.
Somando as cinco entregas de tela: ~44 dias de uma pessoa, ~60 com QA e
retrabalho. `app/(app)/sdr-ia/leads/page.tsx` (1.178 linhas) aparece em duas
entregas — na 4 pela lista, na 5 pelo assistente — contado uma vez em cada, sem
sobreposição.
