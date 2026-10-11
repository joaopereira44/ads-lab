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
node --env-file=.env run.mjs --url "<URL da Ad Library>" --name <slug> --limit 300 --budget 0.5
```

- `--apify-run <id>` reaproveita uma coleta ja paga (nao cobra de novo).
- Rodar de novo com o mesmo `--name` retoma de onde parou; transcricao e Jev ficam em cache.
- Saida: `data/runs/<slug>/run.json` e `data/runs/<slug>/report.html`.

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
