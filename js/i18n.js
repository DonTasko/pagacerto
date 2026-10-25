/* PagaCerto — idiomas. O texto em português é a própria chave: t('Texto em PT') devolve o PT (base) ou a tradução.
 * Sem tradução, devolve o português (nunca fica vazio). Parâmetros: t('Tem {n} dias', { n: 3 }).
 * Idioma: escolha guardada (localStorage 'pc_lang': 'auto' | 'pt' | 'en'); em 'auto' segue o idioma do telemóvel/browser
 * (en* → inglês, tudo o resto → português). Mudar de idioma recarrega a página.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PagaI18n = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EN = {
    // --- rótulos
    'No próprio dia': 'On the day', '1 dia antes': '1 day before', '3 dias antes': '3 days before', '5 dias antes': '5 days before', '7 dias antes': '7 days before',
    'Multibanco (entidade e referência)': 'Multibanco (entity and reference)', 'Pagamento ao Estado (só referência)': 'Payment to the State (reference only)', 'Transferência ou outro': 'Bank transfer or other',
    'Mensal': 'Monthly', 'Bimestral': 'Every 2 months', 'Trimestral': 'Quarterly', 'Semestral': 'Every 6 months', 'Anual': 'Yearly', 'Personalizado': 'Custom',
    'No Multibanco: Pagamentos e outros serviços → Estado e sector público → Pagamentos ao Estado. Introduza a referência e confirme o montante.': 'At a Multibanco ATM: Payments and other services → State and public sector → Payments to the State. Enter the reference and confirm the amount.',
    'Palavra-passe incorreta. Tente outra vez:': 'Wrong password. Try again:', 'Este PDF tem palavra-passe. Introduza-a para o ler:': 'This PDF is password-protected. Enter the password to read it:',
    'A ler o PDF…': 'Reading the PDF…',
    'Este PDF não tem texto (parece uma imagem digitalizada). Por agora escreva os dados à mão. A leitura de fotografias chega numa próxima versão.': 'This PDF has no text (it looks like a scanned image). For now, type the details by hand. Reading photos will come in a later version.',
    'Não foi possível ler o PDF.': 'Could not read the PDF.', 'O PDF é demasiado grande (máximo 15 MB).': 'The PDF is too large (15 MB maximum).',
    'Importação cancelada: o PDF tem palavra-passe.': 'Import cancelled: the PDF is password-protected.', 'Este ficheiro não parece ser um PDF válido.': 'This file does not look like a valid PDF.',
    // --- navegação
    'Início': 'Home', 'Calendário': 'Calendar', 'Pagamentos': 'Payments', 'Histórico': 'History', 'Definições': 'Settings', 'Novo pagamento': 'New payment', 'Sem nome': 'No name',
    // --- onboarding / início
    'Não volte a esquecer um pagamento.': 'Never forget a payment again.', 'Receba a fatura': 'Receive the bill', 'Partilhe com o PagaCerto': 'Share it with PagaCerto', 'Nós ajudamos a criar o lembrete': 'We help you set up the reminder',
    'Os seus dados ficam só neste telemóvel. Não pedimos acesso ao seu email nem ao seu banco.': 'Your data stays on this phone only. We never ask for access to your email or your bank.',
    'COMEÇAR': 'GET STARTED', 'Bom dia': 'Good morning', 'Boa tarde': 'Good afternoon', 'Boa noite': 'Good evening',
    'Tem {n} pagamento em atraso: {names}.': 'You have {n} overdue payment: {names}.', 'Tem {n} pagamentos em atraso: {names}.': 'You have {n} overdue payments: {names}.',
    'Pagamentos próximos': 'Upcoming payments', 'Tem {n} pagamento nos próximos 7 dias.': 'You have {n} payment in the next 7 days.', 'Tem {n} pagamentos nos próximos 7 dias.': 'You have {n} payments in the next 7 days.',
    'EM ATRASO': 'OVERDUE', 'HOJE': 'TODAY', 'AMANHÃ': 'TOMORROW',
    'JAN': 'JAN', 'FEV': 'FEB', 'MAR': 'MAR', 'ABR': 'APR', 'MAI': 'MAY', 'JUN': 'JUN', 'JUL': 'JUL', 'AGO': 'AUG', 'SET': 'SEP', 'OUT': 'OCT', 'NOV': 'NOV', 'DEZ': 'DEC',
    'Sem pagamentos por pagar nos próximos 30 dias.': 'No payments due in the next 30 days.', 'Toque em <b>+</b> para adicionar o primeiro.': 'Tap <b>+</b> to add your first one.',
    'Ver todos': 'See all', 'O que tem para pagar': 'What you have to pay', 'A pagar este mês': 'To pay this month', 'Já pago': 'Already paid', 'Em atraso': 'Overdue', 'Próximos pagamentos': 'Upcoming payments',
    'Resumo': 'Summary', 'Próximos 7 dias': 'Next 7 days', 'Por categoria este mês': 'By category this month', 'Últimos 6 meses': 'Last 6 months', 'Sem pagamentos para mostrar.': 'No payments to show.',
    // --- listas
    '{n} resultado em todos os pagamentos': '{n} result across all payments', '{n} resultados em todos os pagamentos': '{n} results across all payments', 'Nada por aqui.': 'Nothing here.',
    'Pesquisar: Vodafone, 120, Prestação 3…': 'Search: Vodafone, 120, Installment 3…', 'Por pagar': 'To pay', 'Pagos': 'Paid', 'Todos': 'All',
    // --- detalhe
    'Plano de prestações': 'Installment plan', 'Repetição': 'Repeat', 'ref.': 'ref.', 'Vencimento': 'Due date', 'Tipo': 'Type', 'Prestação': 'Installment', 'Entidade': 'Entity', 'Referência': 'Reference',
    'Número da fatura': 'Invoice number', 'Categoria': 'Category', 'Descrição': 'Description', 'Notas': 'Notes', 'Pago em': 'Paid on', 'Lembretes': 'Reminders', 'Sem lembretes': 'No reminders',
    'Reabrir (voltar a pendente)': 'Reopen (back to pending)', 'Marcar como pago': 'Mark as paid', 'Adicionar ao Google Calendar': 'Add to Google Calendar', 'Editar': 'Edit', 'Eliminar': 'Delete',
    'Pendente': 'Pending', 'Pago': 'Paid',
    // --- formulário
    'Não encontrado. Preencha à mão.': 'Not found. Fill it in by hand.', 'Confirme este campo.': 'Please confirm this field.', 'Colar texto da fatura': 'Paste bill text',
    'Cole aqui o texto do email ou da fatura. O PagaCerto tenta preencher os campos, e você confirma.': 'Paste the text of the email or bill here. PagaCerto tries to fill in the fields, and you confirm.',
    'Reconhecer dados': 'Read details', 'Importar PDF': 'Import PDF', 'PAGAMENTO ENCONTRADO': 'PAYMENT FOUND',
    'Confira cada campo antes de guardar. Os campos a laranja precisam da sua confirmação.': 'Check each field before saving. Orange fields need your confirmation.',
    'Só este pagamento': 'This payment only', 'Plano de prestações (criar todas)': 'Installment plan (create all)', 'Pagamento recorrente': 'Recurring payment', 'Número de prestações': 'Number of installments', 'Periodicidade': 'Frequency',
    'O valor e a data acima são os da 1.ª prestação. Cada prestação fica individual, e pode editar a referência de cada uma.': 'The amount and date above are for the 1st installment. Each installment is separate, and you can edit the reference of each one.',
    'Repete-se': 'Repeats', 'De quantos em quantos meses': 'Every how many months', 'Cria já as próximas {n} ocorrências e junta uma nova sempre que pagar uma.': 'Creates the next {n} occurrences now and adds a new one each time you pay one.',
    'Cancelar': 'Cancel', 'Editar pagamento': 'Edit payment', 'Nome / Emissor': 'Name / Issuer', 'Ex.: Vodafone': 'E.g. Vodafone', 'Valor (€)': 'Amount (€)', 'Data de vencimento': 'Due date', 'Tipo de pagamento': 'Payment type',
    'Entidade (Multibanco, 5 dígitos)': 'Entity (Multibanco, 5 digits)', 'Referência (Multibanco, 9 dígitos)': 'Reference (Multibanco, 9 digits)', 'IBAN (opcional)': 'IBAN (optional)', 'Número da fatura (opcional)': 'Invoice number (optional)',
    'Descrição (opcional)': 'Description (optional)', 'Notas (opcional)': 'Notes (optional)', 'Este pagamento é uma prestação': 'This payment is an installment', 'de': 'of', 'Criar lembrete': 'Set a reminder',
    'GUARDAR': 'SAVE', 'ADICIONAR PAGAMENTO': 'ADD PAYMENT', 'Referência para pagamento (15 dígitos)': 'Payment reference (15 digits)', 'Referência (opcional)': 'Reference (optional)',
    'Indique o nome de quem emite o pagamento.': 'Enter the name of who issues the payment.', 'Indique um valor válido, por exemplo 87,43.': 'Enter a valid amount, for example 87.43.', 'Indique a data de vencimento.': 'Enter the due date.',
    'A entidade Multibanco tem 5 dígitos.': 'A Multibanco entity has 5 digits.', 'A referência Multibanco tem 9 dígitos.': 'A Multibanco reference has 9 digits.',
    'A referência de um pagamento ao Estado tem 15 dígitos. Confira o documento.': 'A payment reference for the State has 15 digits. Check the document.', 'A referência só pode ter dígitos.': 'The reference can only contain digits.',
    'O IBAN não é válido. Confirme cada dígito ou apague o campo.': 'The IBAN is not valid. Check each digit or clear the field.', 'Indique a prestação, por exemplo 3 de 12.': 'Enter the installment, for example 3 of 12.',
    'O plano tem de ter entre 2 e 120 prestações.': 'The plan must have between 2 and 120 installments.', 'Indique de quantos em quantos meses (1 a 60).': 'Enter every how many months (1 to 60).',
    // --- parser (avisos)
    'Foram encontrados vários valores. Confirme qual é o total a pagar.': 'Several amounts were found. Confirm which one is the total to pay.',
    'Foram encontradas várias datas. Confirme a data de vencimento.': 'Several dates were found. Confirm the due date.',
    'A referência não tinha etiqueta. Confirme se é mesmo a referência Multibanco.': 'The reference had no label. Confirm it is really the Multibanco reference.',
    'O IBAN encontrado não passa a validação. Confirme cada dígito.': 'The IBAN found does not pass validation. Check each digit.',
    'Foi encontrada a entidade, mas não a referência Multibanco.': 'The entity was found, but not the Multibanco reference.',
    'Pagamento ao Estado: só precisa da referência e do valor. A data limite não foi encontrada no texto, indique-a.': 'Payment to the State: you only need the reference and the amount. The deadline was not found in the text, please enter it.',
    // --- calendário / histórico
    'Mês anterior': 'Previous month', 'Mês seguinte': 'Next month', '{n} pagamento · por pagar {amount}': '{n} payment · {amount} to pay', '{n} pagamentos · por pagar {amount}': '{n} payments · {amount} to pay',
    'Seg': 'Mon', 'Ter': 'Tue', 'Qua': 'Wed', 'Qui': 'Thu', 'Sex': 'Fri', 'Sáb': 'Sat', 'Dom': 'Sun', 'Próximo': 'Upcoming', 'Recorrente': 'Recurring',
    'Voltar a este mês': 'Back to this month', 'Sem pagamentos neste dia.': 'No payments on this day.', 'Toque num dia': 'Tap a day', '{n} pagamento': '{n} payment', '{n} pagamentos': '{n} payments',
    'Nenhum pagamento com estes filtros.': 'No payments match these filters.', 'Pesquisar em todos os pagamentos…': 'Search all payments…', 'Pendentes': 'Pending',
    'Todos os meses': 'All months', 'Todas as entidades': 'All issuers', 'Todas as categorias': 'All categories',
    // --- definições
    'não suportado neste browser': 'not supported in this browser', 'ativo': 'active', 'ainda não ativo': 'not active yet', 'outro': 'other', 'sim': 'yes', 'não': 'no',
    'A app já está instalada e a abrir em ecrã inteiro.': 'The app is already installed and opens full screen.', 'Instalar no ecrã inicial': 'Add to home screen',
    'O browser ainda não ofereceu a instalação.': 'The browser has not offered installation yet.', 'Ligação segura (HTTPS):': 'Secure connection (HTTPS):', '(parece estar dentro de outra app)': '(seems to be inside another app)',
    'Abra este endereço diretamente no Chrome (se veio de um link dentro de outra app, copie o endereço e cole no Chrome). Depois procure "Instalar app" no menu ⋮.': 'Open this address directly in Chrome (if you came from a link inside another app, copy the address and paste it into Chrome). Then look for "Install app" in the ⋮ menu.',
    'Privacidade': 'Privacy',
    'Por omissão, os seus pagamentos ficam apenas neste dispositivo. Só se criar conta (opcional) é que são guardados na nuvem, cifrados com uma frase-passe só sua. Nunca é pedido acesso ao seu email nem ao banco. Na app Android gratuita há anúncios (Google AdMob), sujeitos ao seu consentimento.': 'By default, your payments stay on this device only. Only if you create an account (optional) are they stored in the cloud, encrypted with a passphrase only you know. Access to your email or your bank is never requested. The free Android app shows ads (Google AdMob), subject to your consent.',
    'Política de Privacidade': 'Privacy Policy', 'Termos de Utilização': 'Terms of Use', 'Idioma': 'Language', 'Automático': 'Automatic', 'Instalar': 'Install',
    'Dados de exemplo': 'Sample data', 'Remover dados de exemplo': 'Remove sample data', 'Carregar dados de exemplo': 'Load sample data', 'Dados': 'Data', 'Apagar todos os dados': 'Delete all data', 'versão 0.7 (versão gratuita)': 'version 0.7 (free version)',
    'Anúncios': 'Ads', 'A versão gratuita mostra um banner em baixo e, de vez em quando, um anúncio de ecrã inteiro depois de guardar pagamentos. Os seus pagamentos nunca são usados para escolher anúncios.': 'The free version shows a banner at the bottom and, now and then, a full-screen ad after you save payments. Your payments are never used to choose ads.',
    'Preferências de anúncios e privacidade': 'Ad and privacy preferences',
    'Os lembretes funcionam na app Android. No browser não são fiáveis, porque o browser não acorda em segundo plano.': 'Reminders work in the Android app. In the browser they are not reliable, because the browser does not wake up in the background.',
    'As notificações estão desligadas. Sem elas a app não o pode avisar.': 'Notifications are turned off. Without them the app cannot alert you.', 'Permitir notificações': 'Allow notifications',
    '{n} lembrete(s) agendado(s).': '{n} reminder(s) scheduled.', 'Lembretes desligados.': 'Reminders are off.', 'Hora dos avisos': 'Reminder time', 'Desligar lembretes': 'Turn reminders off', 'Ligar lembretes': 'Turn reminders on', 'Enviar notificação de teste': 'Send a test notification',
    // --- conta
    'Conta e sincronização': 'Account and sync', 'Escolha a nova palavra-passe.': 'Choose your new password.', 'Nova palavra-passe (mínimo 8 caracteres)': 'New password (at least 8 characters)', 'Guardar palavra-passe': 'Save password',
    'Sair da conta': 'Sign out', 'ainda não': 'not yet', 'Última sincronização:': 'Last sync:', 'Sincronizar agora': 'Sync now', 'Apagar conta e dados na nuvem': 'Delete account and cloud data',
    'Os pagamentos desta conta são guardados em servidores na Europa (Londres) para aparecerem nos seus outros dispositivos.': 'This account\'s payments are stored on servers in Europe (London) so they appear on your other devices.',
    'Opcional. Sem conta, tudo fica só neste dispositivo. Com conta, os seus pagamentos são guardados na nuvem e aparecem em todos os dispositivos onde entrar.': 'Optional. Without an account, everything stays on this device only. With an account, your payments are stored in the cloud and appear on every device you sign in on.',
    'Email': 'Email', 'Palavra-passe (mínimo 8 caracteres)': 'Password (at least 8 characters)', 'Entrar': 'Sign in', 'Criar conta': 'Create account', 'Esqueci a palavra-passe': 'Forgot password',
    'Atenção:': 'Warning:', 'a frase-passe não pode ser recuperada por nós. Se a perder, os dados guardados na nuvem ficam ilegíveis (os dispositivos onde já entrou mantêm os seus dados).': 'we cannot recover the passphrase. If you lose it, the data stored in the cloud becomes unreadable (devices you are already signed in on keep their data).',
    'Vai apagar os dados cifrados na nuvem e criar uma nova frase-passe. Os pagamentos deste dispositivo voltam a ser enviados.': 'This will delete the encrypted data in the cloud and create a new passphrase. The payments on this device will be uploaded again.',
    'Para proteger os seus pagamentos, escolha uma <b>frase-passe</b>. Os dados são cifrados neste dispositivo antes de irem para a nuvem: nem nós os conseguimos ler.': 'To protect your payments, choose a <b>passphrase</b>. Data is encrypted on this device before going to the cloud: not even we can read it.',
    'Frase-passe (mínimo 10 caracteres)': 'Passphrase (at least 10 characters)', 'Repita a frase-passe': 'Repeat the passphrase', 'Apagar nuvem e criar nova frase-passe': 'Delete cloud data and create a new passphrase', 'Ativar cifragem e sincronizar': 'Turn on encryption and sync',
    'Introduza a frase-passe desta conta para ver e sincronizar os seus pagamentos neste dispositivo.': 'Enter this account\'s passphrase to see and sync your payments on this device.', 'Frase-passe': 'Passphrase', 'Desbloquear': 'Unlock', 'Perdi a frase-passe': 'I lost my passphrase',
    'Este dispositivo já esteve ligado a outra conta. Os pagamentos locais serão apagados e substituídos pelos desta conta. Continuar?': 'This device was previously linked to another account. Local payments will be deleted and replaced by this account\'s. Continue?',
    'Entrada cancelada.': 'Sign-in cancelled.', 'Cole primeiro o texto da fatura.': 'Paste the bill text first.', 'Eliminar este pagamento? Esta ação não pode ser desfeita.': 'Delete this payment? This cannot be undone.',
    'Este pagamento faz parte de um plano ou de uma repetição.\n\nOK: eliminar também os seguintes que ainda estão por pagar.\nCancelar: eliminar só este.': 'This payment is part of a plan or a repeat.\n\nOK: also delete the following ones that are still unpaid.\nCancel: delete only this one.',
    'Apagar TODOS os pagamentos? Como tem conta, também serão apagados nos seus outros dispositivos e na nuvem. Não pode ser desfeito.': 'Delete ALL payments? Since you have an account, they will also be deleted on your other devices and in the cloud. This cannot be undone.',
    'Apagar TODOS os pagamentos deste dispositivo? Esta ação não pode ser desfeita.': 'Delete ALL payments on this device? This cannot be undone.',
    'Notificações permitidas.': 'Notifications allowed.', 'Permissão recusada. Ative em Definições do Android → Apps → PagaCerto → Notificações.': 'Permission denied. Turn it on in Android Settings → Apps → PagaCerto → Notifications.',
    'Vai receber uma notificação daqui a 5 segundos. Pode sair da app para ver como aparece.': 'You will get a notification in 5 seconds. You can leave the app to see how it looks.', 'Sem permissão para notificações.': 'No permission for notifications.',
    'Preencha o email e a palavra-passe.': 'Enter your email and password.', 'A palavra-passe tem de ter pelo menos 8 caracteres.': 'The password must be at least 8 characters.',
    'Enviámos um email de confirmação para {email}. Abra o link (veja também o spam) e depois volte aqui para entrar.': 'We sent a confirmation email to {email}. Open the link (check spam too) and then come back here to sign in.',
    'Escreva primeiro o seu email.': 'Enter your email first.', 'Se existir uma conta com esse email, enviámos um link para escolher nova palavra-passe.': 'If an account exists with that email, we sent a link to choose a new password.',
    'Palavra-passe alterada.': 'Password changed.', 'As duas frases-passe não coincidem.': 'The two passphrases do not match.', 'Cifragem ativada. Guarde a frase-passe num local seguro.': 'Encryption turned on. Keep the passphrase somewhere safe.',
    'Desbloqueado. Dados sincronizados.': 'Unlocked. Data synced.', 'Isto apaga TODOS os pagamentos guardados na nuvem e recomeça com a nova frase-passe. Só os dados que existirem neste dispositivo voltam a ser enviados. Continuar?': 'This deletes ALL payments stored in the cloud and starts over with the new passphrase. Only data that exists on this device will be uploaded again. Continue?',
    'Nova frase-passe criada.': 'New passphrase created.', 'Sincronizado.': 'Synced.', 'Saiu da conta. Os dados continuam neste dispositivo.': 'Signed out. Your data stays on this device.',
    'Apagar a conta e todos os pagamentos guardados na nuvem? Esta ação não pode ser desfeita. Os dados deste dispositivo mantêm-se.': 'Delete the account and all payments stored in the cloud? This cannot be undone. Data on this device is kept.',
    'Tem a certeza? Confirme para apagar a conta definitivamente.': 'Are you sure? Confirm to delete the account permanently.', 'Conta apagada. Os pagamentos deste dispositivo mantêm-se.': 'Account deleted. The payments on this device are kept.',
    'Ocorreu um erro:': 'An error occurred:', 'A sessão expirou. Entre novamente.': 'Your session expired. Sign in again.', 'Conta confirmada. Sessão iniciada.': 'Account confirmed. You are signed in.',
    // --- sync.js
    'Sem ligação à internet.': 'No internet connection.', 'Email ou palavra-passe incorretos.': 'Wrong email or password.', 'Confirme primeiro o email (veja a caixa de entrada e o spam).': 'Confirm your email first (check your inbox and spam).',
    'Já existe uma conta com este email.': 'An account with this email already exists.', 'Palavra-passe demasiado fraca (mínimo 8 caracteres).': 'Password too weak (at least 8 characters).', 'Demasiados pedidos. Tente novamente daqui a alguns minutos.': 'Too many requests. Try again in a few minutes.',
    'A nova palavra-passe tem de ser diferente da anterior.': 'The new password must be different from the old one.', 'Email inválido.': 'Invalid email.', 'Sem sessão. Abra outra vez o link do email.': 'No session. Open the email link again.', 'Sem sessão.': 'No session.',
    'O link expirou ou já foi usado. Peça um novo.': 'The link expired or was already used. Request a new one.', 'Erro no link do email.': 'Error in the email link.',
    'Já existe uma frase-passe nesta conta. Introduza-a para desbloquear.': 'This account already has a passphrase. Enter it to unlock.', 'Esta conta ainda não tem frase-passe.': 'This account has no passphrase yet.',
    'Frase-passe incorreta.': 'Wrong passphrase.', 'A frase-passe deve ter pelo menos 10 caracteres.': 'The passphrase must be at least 10 characters.',
    'Escolha uma frase-passe menos previsível (não só números nem repetições).': 'Choose a less predictable passphrase (not just numbers or repeated characters).',
    'Base de dados bloqueada por outro separador.': 'Database blocked by another tab.',
    // --- models / notify
    'Periodicidade desconhecida:': 'Unknown frequency:', 'Pagar': 'Pay', 'pagamento': 'payment', 'Valor': 'Amount', 'Fatura': 'Invoice',
    'Em atraso desde {date}. Abra a app para pagar ou marcar como pago.': 'Overdue since {date}. Open the app to pay or mark as paid.', 'Vence hoje ({date}).': 'Due today ({date}).', 'Vence amanhã ({date}).': 'Due tomorrow ({date}).', 'Vence em {n} dias ({date}).': 'Due in {n} days ({date}).',
    'Pagamento': 'Payment', 'Lembretes de pagamentos': 'Payment reminders', 'Assim vão aparecer os seus lembretes.': 'This is how your reminders will look.',
    // --- categorias
    'Casa': 'Home', 'Eletricidade': 'Electricity', 'Água': 'Water', 'Gás': 'Gas', 'Telecomunicações': 'Telecom', 'Impostos': 'Taxes', 'Segurança Social': 'Social Security', 'Seguros': 'Insurance',
    'Financiamentos': 'Financing', 'Empréstimos': 'Loans', 'Rendas': 'Rent', 'Subscrições': 'Subscriptions', 'Compras': 'Shopping', 'Outros': 'Other', 'Autoridade Tributária': 'Tax Authority', 'Financiamento': 'Financing'
  };
  // mensagens com número (ex.: "Erro do servidor (500).")
  const PATTERNS = [[/^Erro do servidor \((\d+)\)\.$/, m => 'Server error (' + m[1] + ').']];

  const LANGS = [['auto', 'auto'], ['pt', 'Português'], ['en', 'English']];
  const STORE = 'pc_lang';

  function setting() { try { return localStorage.getItem(STORE) || 'auto'; } catch (e) { return 'auto'; } }
  function detect() {
    const n = (typeof navigator !== 'undefined' && (navigator.languages && navigator.languages[0] || navigator.language)) || 'pt';
    return /^en/i.test(n) ? 'en' : 'pt';
  }
  function lang() { const s = setting(); return s === 'en' || s === 'pt' ? s : detect(); }
  function set(v) { try { localStorage.setItem(STORE, v); } catch (e) { /* sem armazenamento: fica o automático */ } }
  const locale = () => (lang() === 'en' ? 'en-GB' : 'pt-PT');

  function t(key, params) {
    let s = key;
    if (lang() === 'en') {
      if (Object.prototype.hasOwnProperty.call(EN, key)) s = EN[key];
      else for (const [re, fn] of PATTERNS) { const m = re.exec(key); if (m) { s = fn(m); break; } }
    }
    if (params) s = s.replace(/\{(\w+)\}/g, (m, n) => (n in params ? params[n] : m));
    return s;
  }

  return { t, lang, locale, setting, set, LANGS, EN };
}));
