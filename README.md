# PagaCerto (fase 1)

Web app (HTML/JS, sem dependências) para lembretes de pagamentos. Pensada para depois ser empacotada como app Android com Capacitor.

## Correr no computador
```
npm test            # 33 testes (parser + modelos), precisa de Node 20+
npm run serve       # http://localhost:8080
```
Abre no telemóvel (mesma rede) ou no Chrome com as ferramentas de programador em modo telemóvel.

## O que já funciona
- Onboarding, dashboard (totais, alertas de atraso e dos próximos 7 dias)
- Novo pagamento manual, editar, eliminar, marcar como pago (guarda data e hora), reabrir
- **Colar texto de fatura -> reconhecer -> confirmar -> guardar** (parser em `www/js/parser.js`)
- Campos duvidosos ficam a laranja; campos não encontrados ficam vazios
- A app aprende "entidade 12345 = EDP" quando confirmas um pagamento
- Dados só no dispositivo (IndexedDB), a funcionar offline
- Dados de exemplo (Definições)

## Ainda não existe (próximas fases)
Calendário, histórico e pesquisa, notificações, plano de prestações e recorrência, receber "Partilhar" no Android, PDF, OCR, PIN/biometria, exportar/importar, calendário do telemóvel.

## Estrutura
```
www/index.html
www/css/style.css
www/js/parser.js   texto -> campos (Node e browser)
www/js/models.js   estados, datas, prestações, recorrência
www/js/db.js       IndexedDB
www/js/repo.js     repositórios (a UI só fala com estes)
www/js/app.js      interface e rotas
www/sw.js          cache offline
www/manifest.webmanifest   inclui share_target (PWA)
tests/
```

## Gancho para a partilha (fase 2)
`window.PagaApp.handleSharedText(texto, assunto)` é o ponto de entrada. O plugin nativo do Capacitor, ou o `share_target` da PWA, só tem de o chamar.
