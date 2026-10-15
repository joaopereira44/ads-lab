# Ads Lab

Irmao do [creator-lab](https://github.com/joaopereira44/creator-lab), para anuncios.
Pega uma pagina da Meta Ad Library, agrupa os anuncios por criativo, transcreve o
video e o Jev classifica cada roteiro (macro nicho, angulo, abertura, gancho, nivel
de consciencia, prova, oferta, CTA). Gera um relatorio HTML que cruza esses padroes
com a posicao no ranking de impressoes da propria Ad Library.

## Rodar

```bash
cp .env.example .env    # preencher APIFY_TOKEN, GROQ_API_KEY, TYPESAFE_API_KEY
npm run doctor          # prova as chaves sem gastar nada
npm start               # painel em http://127.0.0.1:5191
```

No painel: **Nova analise**, cole a URL da pagina na Ad Library e um nome em kebab-case.
O painel e o mesmo do creator-lab (parede de criativos, mapa, inspetor do roteiro,
tabela de padroes, comparacao lado a lado, replay), com as metricas de anuncio:

- Eixo X: posicao no ranking de impressoes da Ad Library (ou anuncios no mesmo criativo).
- Eixo Y: dias no ar.
- Tabela: posicao mediana, criativos no topo (10% melhores posicoes), anuncios por criativo, dias no ar.

Pausar manda SIGTERM ao `run.mjs`: o que terminou fica salvo, e retomar puxa do cache.

Sem painel, pelo terminal:

```bash
node --env-file=.env run.mjs --url "<URL da Ad Library>" --name <slug> --limit 300 --budget 0.5
```

- `--apify-run <id>` reaproveita uma coleta ja paga (nao cobra de novo).
- Rodar de novo com o mesmo `--name` retoma de onde parou; transcricao e Jev ficam em cache.
- Saida: `data/runs/<slug>/run.json` e `data/runs/<slug>/report.html` (relatorio estatico, tambem em `/report/<slug>` no painel).
- A coleta iniciada fica em `scrape.json`: pausar ou cair durante a coleta nunca cobra a Apify duas vezes.

### Funil do destino (prototipo)

`--funil` faz um retrato datado de cada URL de destino dos anuncios (ate 3, `--funil-max`):

- **Fluxo:** se a pagina e um quiz do xQuiz, le o fluxo inteiro que ela entrega no carregamento
  (perguntas, opcoes, precos, VSL, teste A/B, paginas desligadas, links de checkout).
- **Rede:** abre o Chrome ou Edge instalado em modo headless (protocolo DevTools, sem npm; `CHROME_PATH`
  se nao achar), clica a primeira opcao de cada pergunta e registra pixel, eventos e ferramentas
  (Meta, UTMify, Taboola, Google, Clarity, TikTok, contador proprio, player de video).
  Nunca preenche formulario: para quando aparece campo. O Meta bloqueia navegador automatico,
  entao o retrato nao prova disparo de evento do Pixel.
- **Etiqueta:** cada achado sai como observado, inferido ou desconhecido.

Salva em `data/runs/<slug>/funil/AAAA-MM-DD.json`, compara com a leitura anterior (pergunta,
preco, VSL, pixel, checkout, A/B) e mostra no `report.html`. Cerca de 1 min por destino, sem custo.

```bash
node --env-file=.env run.mjs --name victor-molinn --funil
```

Precisa de Node 22.9+ e, so para video que a Groq nao consegue baixar, FFmpeg no PATH.

## Custos (piloto com 251 anuncios, 108 criativos)

| Etapa | Servico | Custo |
|---|---|---|
| Coletar | Apify `curious_coder~facebook-ads-library-scraper` | US$ 0,00075 por anuncio (~US$ 0,19 por 250) |
| Transcrever | Groq whisper-large-v3-turbo | Cota gratis |
| Classificar | Jev (TypeSafe) | Centavos |

## O que a Ad Library da e o que nao da

- Fora da UE e de anuncio politico, a Meta **nao mostra impressao nem gasto**. O sinal
  de escala e indireto: a posicao na ordenacao "total de impressoes", quantos anuncios
  rodam o mesmo criativo (`collation_count`) e ha quantos dias o criativo esta no ar.
- Descreve a amostra, nao prova causa.

Licenca MIT. Codigo de request, pacing e transcricao vem do creator-lab (Artem Novitckii, MIT).
