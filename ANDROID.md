# PagaCerto — versão Android

## O que precisa
- Android Studio recente (o projeto usa Android Gradle Plugin 8.13 e compileSdk 36; se o Android Studio pedir para atualizar, aceite).
- Um telemóvel Android com "Depuração USB" ligada, ou um emulador.

## Abrir e correr
1. Descompacte o zip.
2. Android Studio → **File → Open** → escolha a pasta **`android`** (não a pasta de cima).
3. Espere o "Gradle sync" acabar (a primeira vez descarrega bastante).
4. Ligue o telemóvel por USB e carregue em ▶ **Run**.

O projeto já traz os dois pacotes Capacitor necessários em `node_modules` (versões exatas 8.5.2 e 8.3.1, sem alterações). Se preferir instalar a partir do npm: `npm ci --ignore-scripts`.

## Testar
- **Partilhar:** no Gmail abra um email → ⋮ → Partilhar (ou selecione o texto → Partilhar) → **PagaCerto**. Abre o formulário já preenchido, para confirmar.
- **Selecionar texto:** selecione texto em qualquer app → menu ⋮ → **PagaCerto**.
- **Lembretes:** Definições → **Permitir notificações** → "Enviar notificação de teste". Crie um pagamento com vencimento daqui a 1 dia e veja os lembretes agendados em Definições.
- Alguns telemóveis (Xiaomi, Huawei, Samsung...) matam alarmes em segundo plano. Se os lembretes não chegarem: Definições do Android → Apps → PagaCerto → Bateria → **Sem restrições**.

## Atualizar a app depois de mudar a parte web
Copie os ficheiros novos para `www/` e depois: `npx cap sync android` (precisa de Node). Sem Node, copie `www/` para `android/app/src/main/assets/public/`.

## Gerar ficheiros para instalar
- **APK de teste:** Build → Build Bundle(s) / APK(s) → Build APK(s).
- **AAB para a Play Store:** Build → Generate Signed App Bundle → Android App Bundle → crie uma keystore.
  **Guarde a keystore e as palavras-passe em segurança e com cópia.** Sem elas não consegue publicar atualizações (a menos que use a assinatura da Play).
- Em cada nova versão suba `versionCode` (e `versionName`) em `app/build.gradle`.

## Antes da primeira publicação
- **ID da app:** está como `pt.lapps.pagacerto`. Depois de publicado **não pode ser mudado**. Se quiser outro, mude agora em: `app/build.gradle` (namespace e applicationId), `capacitor.config.json`, `strings.xml` e no nome do pacote/pasta dos ficheiros Java.
- Play Console pede: política de privacidade (URL), formulário "Segurança dos dados", classificação de conteúdo.
- Permissões usadas: INTERNET (só para a conta opcional), POST_NOTIFICATIONS (lembretes). O plugin de notificações acrescenta o arranque do telemóvel para repor os alarmes.

## Diferenças em relação à versão web
- Os dados da app Android são separados dos da versão web (armazenamento diferente). Para os juntar, use a conta em Definições.
- Os links dos emails (confirmar conta, recuperar palavra-passe) abrem a versão web. Depois volte à app e entre.
- Ainda não tem: importar PDF, foto/OCR, PIN/biometria, exportar/importar ficheiro.
