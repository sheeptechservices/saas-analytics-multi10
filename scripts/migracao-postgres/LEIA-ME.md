# Cópia do Turso para o Postgres

Dois scripts de uso único, para a virada do banco da aplicação. Rodam da raiz do
repositório e leem `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` e `DATABASE_PUBLIC_URL`
do `.env.local`. Nenhum valor de credencial é impresso, em modo nenhum.

## Por que a `DATABASE_PUBLIC_URL`, e não a `DATABASE_URL`

A `DATABASE_URL` que o **app** usa na Railway aponta para `*.railway.internal`, que
só é alcançável de dentro do projeto. A cópia sai da máquina de quem opera, então
precisa do proxy TCP (`*.proxy.rlwy.net`).

**Desligue o proxy quando a migração terminar.** Enquanto ele existe, o banco aceita
conexão de qualquer lugar da internet.

O proxy apresenta certificado autoassinado na cadeia — verificado, não suposto: a
verificação completa recusa com `SELF_SIGNED_CERT_IN_CHAIN`. Por isso os scripts
cifram sem verificar o certificado, que é o que a topologia permite de fora.

## Ordem

```bash
# 1. Ver o que aconteceria. Não grava nada.
node scripts/migracao-postgres/copiar-turso-para-postgres.mjs --schema

# 2. Copiar de verdade.
node scripts/migracao-postgres/copiar-turso-para-postgres.mjs --executar --corrigir-epoch

# 3. Conferir além da contagem.
node scripts/migracao-postgres/conferir-copia.mjs
```

`--schema` aplica o baseline sem copiar dado — é o que permite ao modo seco ler os
tipos e dizer o que faria.

## O que a cópia faz, em ordem

1. **Aplica `drizzle/0000_baseline_postgres.sql`.** Nada aplica o schema no deploy: o
   `railway.json` roda só `npm run start`, não existe script de migração e o
   `drizzle-kit` é devDependency, fora da imagem de produção.

2. **Registra o baseline em `drizzle.__drizzle_migrations`.** Sem isso, o primeiro
   `drizzle-kit migrate` futuro reexecuta a `0000` e aborta com `42P07` ao tentar
   recriar tabela que já existe.

3. **Copia na ordem das chaves estrangeiras**, derivada do `information_schema` — não
   de uma lista escrita à mão, que envelheceria junto com o schema.

4. **Converte pelo tipo da coluna no destino**, também lido do `information_schema`.
   É o ponto mais perigoso da migração: as colunas `timestamptz` guardavam epoch em
   **segundos** (é o que o drizzle grava em `mode:'timestamp'`) e as `bigint` guardam
   **milissegundos** (`Date.now()` cru). Trocar os grupos dá data em 1970 ou no ano
   58000, **sem erro nenhum**. Derivar do tipo tira a chance de errar.

5. **Limpa NUL e *surrogate* solto** do JSON guardado em texto, e **lista cada linha
   alterada**. O `json_extract` do SQLite nunca validou nada; o `::jsonb` valida o
   documento inteiro a cada leitura, e **uma** linha ruim derruba o painel do SDR e
   todo `reconcile()` daquele cliente, permanentemente. A limpeza é feita no valor
   decodificado, nunca no texto pronto: uma barra invertida literal seguida de
   `u0000` termina nos mesmos seis caracteres, e um `replace` sobre o texto a
   mutilaria, gerando JSON inválido.

6. **Confere a contagem** nos dois bancos e falha se alguma diferir.

É reexecutável: cada tabela é esvaziada antes de receber, e tudo corre numa única
transação. Falhou no meio, nada fica pela metade.

## `--corrigir-epoch`

Código antigo gravou `users.created_at` de uma linha em milissegundos numa coluna
que o schema lê como segundos. Lida como está, ela cai no **ano 58348** — e é isso
que a tela mostra desde maio de 2026. O código de hoje usa `new Date()` e não produz
mais isso.

Sem a opção, o script **copia o valor como está e avisa**. Com ela, trata como
milissegundos. Nunca adivinha em silêncio: adivinhar calado e copiar fielmente uma
data que não existe são duas escolhas, e as duas precisam ser suas.

## O que a conferência checa, além da contagem

Contagem prova que nada se perdeu; não prova que os valores chegaram certos. O
`conferir-copia.mjs` verifica:

- toda coluna de data caiu numa faixa plausível (nada em 1970 nem no ano 58000);
- as colunas `bigint` continuam na casa dos milissegundos;
- amostras linha a linha contra o Turso, **idênticas ao milissegundo**;
- os booleanos batem em quantidade;
- o `events.payload` atravessa o `::jsonb` inteiro — que era o 500 permanente.

## Na virada

**Rode a cópia de novo imediatamente antes de trocar a variável.** Enquanto o app
apontar para o Turso, ele continua gravando lá, e tudo que entrar depois da primeira
cópia ficaria para trás.

Depois: acrescente `DATABASE_URL` (não substitua nada), publique o código da
migração, confira as telas, e só então aponte o webhook da YCloud. Mantenha
`TURSO_*` por alguns dias — reverter para a publicação anterior devolve o app ao
Turso intacto.
