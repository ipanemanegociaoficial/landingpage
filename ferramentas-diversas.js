/**
 * Consulta segura FonteData + gravação na planilha IPANEMA NEGOCIA.
 *
 * Propriedade do script necessária:
 * FONTEDATA_API_KEY = sua chave completa da FonteData
 */

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var acao = String(body.acao || '').toLowerCase();
    
    // SALVA CLIENTE
    if (acao === 'salvar') {
      return salvarCliente_(body);
    }

    // LOGIN DA ÁREA ADMINISTRATIVA
    if (acao === 'adminlogin') {
      return adminLogin_(body);
    }

    // BUSCA DADOS DA ÁREA ADMINISTRATIVA
    if (acao === 'admindados') {
      return adminDados_(body);
    }

    // ALTERAR SENHA ADMINISTRATIVA
    if (acao === 'adminalterarsenha') {
      return adminAlterarSenha_(body);
    }

    // MARCA / DESMARCA RECOLHE NO PAINEL ADMINISTRATIVO
    if (acao === 'adminatualizarrecolhe') {
      return adminAtualizarRecolhe_(body);
    }

    // ATUALIZA SALDO DE CLIQUES (COLUNAS W/X)
    if (acao === 'adminatualizarsaldocliques') {
      return adminAtualizarSaldoCliques_(body);
    }

    // SALVA BOLETO IPANEMA NA ABA BOLETOS
    if (acao === 'salvarboleto') {
      return salvarBoletoIpanema_(body);
    }

    // PIX DEFLOW
    if (acao === 'deflowpix') {
      return gerarPixDeFlowWeb_(body);
    }

    // CONSULTA SPC / SERASA
    if (
      acao === 'spc' ||
      acao === 'consultaai'
    ) {
      return consultarSPC_(body);
    }

    // COMPATIBILIDADE COM A CONSULTA SPC ANTIGA
    // Quando chegar CPF sem "acao" e sem data de nascimento
    if (
      !acao &&
      body.cpf &&
      !body.dataNascimento
    ) {
      return consultarSPC_(body);
    }

    // CONSULTA NORMAL DO CPF
    return validarCliente_(body);

  } catch (erro) {
    console.error(erro);

    return json_({
      sucesso: false,
      validado: false,
      mensagem: 'Ocorreu um erro ao processar a solicitação. Tente novamente.'
    });
  }
}


/**
 * CONSULTA E VALIDA CPF + NASCIMENTO NA FONTEDATA
 */
function validarCliente_(body) {

  var cpf = somenteNumeros_(body.cpf || '');
  var nascimentoInformado = normalizarData_(body.dataNascimento || '');

  if (!validarCPF_(cpf)) {
    return json_({
      sucesso: false,
      validado: false,
      mensagem: 'CPF inválido.'
    });
  }

  if (!nascimentoInformado) {
    return json_({
      sucesso: false,
      validado: false,
      mensagem: 'Data de nascimento inválida.'
    });
  }

  var apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('FONTEDATA_API_KEY');

  if (!apiKey) {
    throw new Error(
      'A propriedade FONTEDATA_API_KEY não foi configurada no Apps Script.'
    );
  }

  var url =
    'https://app.fontedata.com/api/v1/consulta/dados-cadastrais-basicos?cpf=' +
    encodeURIComponent(cpf);

  var resposta = UrlFetchApp.fetch(url, {

    method: 'get',

    muteHttpExceptions: true,

    headers: {
      'X-API-Key': apiKey,
      'Accept': 'application/json'
    }

  });

  var status = resposta.getResponseCode();
  var texto = resposta.getContentText();

  var dados;

  try {

    dados = JSON.parse(texto);

  } catch (erro) {

    throw new Error(
      'A FonteData retornou uma resposta inválida. HTTP ' + status
    );

  }

  if (status < 200 || status >= 300) {

    console.log('FonteData HTTP ' + status + ': ' + texto);

    return json_({
      sucesso: false,
      validado: false,
      mensagem: 'Não foi possível consultar os dados neste momento.'
    });

  }

  var cpfRetorno = somenteNumeros_(dados.cpf || '');

  var nascimentoApi =
    normalizarData_(dados.data_nascimento_br || '');


  /*
   * CONFERE CPF + DATA DE NASCIMENTO
   */

  if (
    cpfRetorno !== cpf ||
    !nascimentoApi ||
    nascimentoApi !== nascimentoInformado
  ) {

    return json_({

      sucesso: true,
      validado: false,
      mensagem: 'Os dados informados não conferem com o cadastro.'

    });

  }


  /*
   * GUARDA TEMPORARIAMENTE OS DADOS NO SERVIDOR
   *
   * Assim nome da mãe não precisa ficar exposto no HTML.
   */

  var token = Utilities.getUuid();

  var cache = CacheService.getScriptCache();


  cache.put(

    'cliente_' + token,

    JSON.stringify({

      cpf: cpfRetorno,

      nome: dados.nome || '',

      nascimento: dados.data_nascimento_br || '',

      mae: dados.nome_mae || ''

    }),

    600

  ); // 10 minutos


  return json_({

    sucesso: true,

    validado: true,

    mensagem: 'Identidade confirmada com sucesso.',

    cpf: cpfRetorno,

    nome: dados.nome || '',

    nascimento: dados.data_nascimento_br || '',

    token: token

  });

}


/**
 * SALVA CLIENTE NA PLANILHA
 */
function salvarCliente_(body) {

  var whatsapp = somenteNumeros_(body.whatsapp || '');
  var email = String(body.email || '').trim().toLowerCase();
  var token = String(body.token || '').trim();

  // Aceita WhatsApp com ou sem o 55.
  if (whatsapp.length === 13 && whatsapp.substring(0, 2) === '55') {
    whatsapp = whatsapp.substring(2);
  }

  if (!validarWhatsApp_(whatsapp)) {
    return json_({
      sucesso: false,
      salvo: false,
      mensagem: 'WhatsApp inválido.'
    });
  }

  if (!validarEmail_(email)) {
    return json_({
      sucesso: false,
      salvo: false,
      mensagem: 'E-mail inválido.'
    });
  }

  if (!token) {
    return json_({
      sucesso: false,
      salvo: false,
      mensagem: 'Validação expirada. Faça a consulta novamente.'
    });
  }

  var cache = CacheService.getScriptCache();
  var cacheTexto = cache.get('cliente_' + token);

  if (!cacheTexto) {
    return json_({
      sucesso: false,
      salvo: false,
      mensagem: 'Sua validação expirou. Informe o CPF novamente.'
    });
  }

  var cliente = JSON.parse(cacheTexto);
  var cpf = somenteNumeros_(cliente.cpf || '');

  if (!validarCPF_(cpf)) {
    return json_({
      sucesso: false,
      salvo: false,
      mensagem: 'CPF de validação inválido.'
    });
  }

  // Abre exatamente a planilha IPANEMA NEGOCIA.
  var planilha = SpreadsheetApp.openById(
    '1xJPl4mFkSIgs0rv1gvzNIupHsBwYSSqJZxbdDOwZla4'
  );

  var aba = planilha.getSheetByName('IPANEMA NEGOCIA');

  if (!aba) {
    throw new Error('A aba IPANEMA NEGOCIA não foi encontrada.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {

    var maxLinhas = aba.getMaxRows();

    // Pesquisa o CPF exclusivamente pela COLUNA E = CPF SEM PONTOS.
    var cpfs = aba.getRange(2, 5, maxLinhas - 1, 1).getDisplayValues();
    var linhaExistente = 0;

    for (var i = 0; i < cpfs.length; i++) {
      var cpfPlanilha = somenteNumeros_(cpfs[i][0]);
      if (cpfPlanilha === cpf) {
        linhaExistente = i + 2;
        break;
      }
    }

    // Grava sempre no padrão internacional 55 + DDD + número.
    var whatsappPlanilha = '55' + whatsapp;

    // Se o CPF já existe, atualiza WhatsApp e E-mail.
    if (linhaExistente > 0) {
      aba.getRange(linhaExistente, 1).setValue(whatsappPlanilha); // A = WHATSAPP
      aba.getRange(linhaExistente, 20).setValue(email);          // T = EMAIL

      SpreadsheetApp.flush();
      cache.remove('cliente_' + token);

      return json_({
        sucesso: true,
        salvo: true,
        existente: true,
        linha: linhaExistente,
        mensagem: 'Cadastro localizado e atualizado com sucesso.'
      });
    }

    // Localiza a primeira linha realmente vazia pela COLUNA A.
    var valoresA = aba.getRange(2, 1, maxLinhas - 1, 1).getDisplayValues();
    var novaLinha = 0;

    for (var n = 0; n < valoresA.length; n++) {
      if (String(valoresA[n][0]).trim() === '') {
        novaLinha = n + 2;
        break;
      }
    }

    // Se não houver linha vazia, cria uma nova linha ao final.
    if (!novaLinha) {
      aba.insertRowAfter(maxLinhas);
      novaLinha = maxLinhas + 1;
    }

    // A = WHATSAPP
    aba.getRange(novaLinha, 1).setValue(whatsappPlanilha);

    // C = NOME COMPLETO
    aba.getRange(novaLinha, 3).setValue(cliente.nome || '');

    // D = CPF INFO formatado e como texto
    aba.getRange(novaLinha, 4)
      .setNumberFormat('@')
      .setValue(formatarCPF_(cpf));

    // G = NASCIMENTO
    aba.getRange(novaLinha, 7).setValue(cliente.nascimento || '');

    // H = MAE
    aba.getRange(novaLinha, 8).setValue(cliente.mae || '');

    // T = EMAIL
    aba.getRange(novaLinha, 20).setValue(email);

    SpreadsheetApp.flush();
    cache.remove('cliente_' + token);

    return json_({
      sucesso: true,
      salvo: true,
      existente: false,
      linha: novaLinha,
      mensagem: 'Cadastro realizado com sucesso.'
    });

  } finally {
    lock.releaseLock();
  }
}


/**
 * SALVA BOLETO IPANEMA NA ABA BOLETOS
 * A = CPF
 * B = NOME CLIENTE
 * C = VENCIMENTO
 * D = VALOR
 * E = CÓDIGO DE BARRAS / LINHA DIGITÁVEL
 * F = GERADO EM
 * G = GERADO POR
 */
function salvarBoletoIpanema_(body) {

  var cpf = String(body.cpf || '').trim();
  var nome = String(body.nome || '').trim();
  var vencimento = String(body.vencimento || '').trim();
  var valor = String(body.valor || '').trim();
  var codigoBarras = String(body.codigoBarras || body.codigo || '').trim();
  var geradoPor = 'Pereira';

  if (!cpf || !nome || !vencimento || !valor || !codigoBarras) {
    return json_({
      sucesso: false,
      salvo: false,
      mensagem: 'Preencha CPF, nome, vencimento, valor e código de barras.'
    });
  }

  var planilha = SpreadsheetApp.openById(
    '1xJPl4mFkSIgs0rv1gvzNIupHsBwYSSqJZxbdDOwZla4'
  );

  var aba = planilha.getSheetByName('BOLETOS');
  if (!aba) {
    throw new Error('A aba BOLETOS não foi encontrada.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    // Evita duplicidade por duplo clique: procura o mesmo CPF + vencimento +
    // valor + código gerado recentemente (últimos 2 minutos).
    var ultimaLinha = aba.getLastRow();
    var agora = new Date();

    if (ultimaLinha >= 2) {
      var inicio = Math.max(2, ultimaLinha - 49);
      var qtd = ultimaLinha - inicio + 1;
      var recentes = aba.getRange(inicio, 1, qtd, 7).getValues();

      for (var i = recentes.length - 1; i >= 0; i--) {
        var linha = recentes[i];
        var mesmoCpf = somenteNumeros_(linha[0]) === somenteNumeros_(cpf);
        var mesmoVencimento = String(linha[2] || '').trim() === vencimento;
        var mesmoValor = normalizarValorAdmin_(linha[3]) === normalizarValorAdmin_(valor);
        var mesmoCodigo = somenteNumeros_(linha[4]) === somenteNumeros_(codigoBarras);
        var dataGeracao = linha[5] instanceof Date ? linha[5] : null;
        var recente = dataGeracao && (agora.getTime() - dataGeracao.getTime()) <= 120000;

        if (mesmoCpf && mesmoVencimento && mesmoValor && mesmoCodigo && recente) {
          return json_({
            sucesso: true,
            salvo: true,
            duplicado: true,
            mensagem: 'Boleto já registrado recentemente.'
          });
        }
      }
    }

    var valorNumerico = Number(normalizarValorAdmin_(valor));

    aba.appendRow([
      cpf,
      nome,
      vencimento,
      isFinite(valorNumerico) ? valorNumerico : valor,
      codigoBarras,
      agora,
      geradoPor
    ]);

    var novaLinha = aba.getLastRow();
    aba.getRange(novaLinha, 1).setNumberFormat('@');
    aba.getRange(novaLinha, 5).setNumberFormat('@');
    aba.getRange(novaLinha, 6).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    if (isFinite(valorNumerico)) {
      aba.getRange(novaLinha, 4).setNumberFormat('R$ #,##0.00');
    }

    SpreadsheetApp.flush();

    return json_({
      sucesso: true,
      salvo: true,
      duplicado: false,
      linha: novaLinha,
      geradoPor: geradoPor,
      mensagem: 'Boleto registrado com sucesso.'
    });

  } finally {
    lock.releaseLock();
  }
}


/**
 * RETORNO JSON
 */
function json_(obj) {

  return ContentService
    .createTextOutput(
      JSON.stringify(obj)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );

}


/**
 * REMOVE PONTOS, TRAÇOS, ESPAÇOS ETC.
 */
function somenteNumeros_(valor) {

  return String(
    valor || ''
  ).replace(
    /\D/g,
    ''
  );

}


/**
 * VALIDA E NORMALIZA DATA
 */
function normalizarData_(valor) {

  var s =
    String(valor || '')
      .trim();


  var m =
    s.match(
      /^(\d{2})\/(\d{2})\/(\d{4})$/
    );


  if (!m) return '';


  var dia =
    Number(m[1]);

  var mes =
    Number(m[2]);

  var ano =
    Number(m[3]);


  var data =
    new Date(
      ano,
      mes - 1,
      dia
    );


  if (
    data.getFullYear() !== ano ||
    data.getMonth() !== mes - 1 ||
    data.getDate() !== dia
  ) {

    return '';

  }


  return (
    m[1] +
    '/' +
    m[2] +
    '/' +
    m[3]
  );

}


/**
 * VALIDA CPF
 */
function validarCPF_(cpf) {

  cpf =
    somenteNumeros_(cpf);


  if (
    cpf.length !== 11 ||
    /^(\d)\1{10}$/.test(cpf)
  ) {

    return false;

  }


  var soma = 0;


  for (
    var i = 0;
    i < 9;
    i++
  ) {

    soma +=
      Number(
        cpf.charAt(i)
      ) *
      (10 - i);

  }


  var d1 =
    11 -
    (soma % 11);


  if (d1 >= 10) {
    d1 = 0;
  }


  if (
    d1 !==
    Number(
      cpf.charAt(9)
    )
  ) {

    return false;

  }


  soma = 0;


  for (
    var j = 0;
    j < 10;
    j++
  ) {

    soma +=
      Number(
        cpf.charAt(j)
      ) *
      (11 - j);

  }


  var d2 =
    11 -
    (soma % 11);


  if (d2 >= 10) {
    d2 = 0;
  }


  return (
    d2 ===
    Number(
      cpf.charAt(10)
    )
  );

}


/**
 * VALIDA WHATSAPP
 *
 * Exemplo:
 * 11999999999
 */
function validarWhatsApp_(numero) {
  numero = somenteNumeros_(numero);

  if (numero.length === 13 && numero.substring(0, 2) === '55') {
    numero = numero.substring(2);
  }

  if (numero.length !== 11) return false;

  var ddd = Number(numero.substring(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  if (numero.charAt(2) !== '9') return false;
  if (/^(\d)\1+$/.test(numero)) return false;

  return true;
}

function validarEmail_(email) {
  email = String(email || '').trim();
  if (email.length < 5 || email.length > 120) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function formatarCPF_(cpf) {
  cpf = somenteNumeros_(cpf);
  if (cpf.length !== 11) return cpf;

  return cpf.substring(0, 3) + '.' +
         cpf.substring(3, 6) + '.' +
         cpf.substring(6, 9) + '-' +
         cpf.substring(9, 11);
}


/**
 * LOGIN ADMINISTRATIVO
 * Cada empresa usa sua própria senha.
 * Também registra cada acesso na aba LOG ADMIN.
 */
function adminLogin_(body) {

  var empresa = normalizarEmpresaAdmin_(body.empresa || '');
  var socio = normalizarSocioAdmin_(body.socio || '');
  var senhaInformada = String(body.senha || '');

  if (!empresa) {
    return json_({
      sucesso: false,
      autorizado: false,
      mensagem: 'Empresa administrativa inválida.'
    });
  }

  if (!socio) {
    return json_({
      sucesso: false,
      autorizado: false,
      mensagem: 'Informe o nome do sócio.'
    });
  }

  var propriedadeSenha = propriedadeSenhaAdmin_(empresa);

  var senhaCorreta = PropertiesService
    .getScriptProperties()
    .getProperty(propriedadeSenha);

  if (!senhaCorreta) {
    return json_({
      sucesso: false,
      autorizado: false,
      mensagem: 'A senha administrativa de ' + empresa + ' ainda não foi configurada.'
    });
  }

  if (senhaInformada !== senhaCorreta) {
    Utilities.sleep(500);

    return json_({
      sucesso: false,
      autorizado: false,
      mensagem: 'Senha incorreta.'
    });
  }

  var token = Utilities.getUuid();

  CacheService
    .getScriptCache()
    .put(
      'admin_' + token,
      JSON.stringify({
        empresa: empresa,
        socio: socio
      }),
      1800
    );

  registrarLogAdmin_(empresa, socio, 'LOGIN');

  return json_({
    sucesso: true,
    autorizado: true,
    token: token,
    empresa: empresa,
    socio: socio,
    mensagem: 'Acesso autorizado.'
  });
}


/**
 * CONFERE SE A SESSÃO ADMINISTRATIVA É VÁLIDA
 * Retorna a empresa vinculada ao token, ou vazio se inválido.
 */
function sessaoAdminToken_(token) {

  token = String(token || '').trim();

  if (!token) {
    return null;
  }

  var texto = CacheService
    .getScriptCache()
    .get('admin_' + token);

  if (!texto) {
    return null;
  }

  try {
    var sessao = JSON.parse(texto);
    if (!sessao || !sessao.empresa || !sessao.socio) return null;
    return sessao;
  } catch (erro) {
    return null;
  }
}


function validarAdminToken_(token, empresaEsperada) {

  var sessao = sessaoAdminToken_(token);

  if (!sessao) {
    return false;
  }

  if (!empresaEsperada) {
    return true;
  }

  return normalizarEmpresaAdmin_(sessao.empresa) === normalizarEmpresaAdmin_(empresaEsperada);
}


/**
 * DADOS DO PAINEL ADMINISTRATIVO
 */
function adminDados_(body) {

  var token = String(body.token || '').trim();
  var empresa = normalizarEmpresaAdmin_(body.empresa || '');

  if (!empresa || !validarAdminToken_(token, empresa)) {
    return json_({
      sucesso: false,
      autorizado: false,
      mensagem: 'Sua sessão expirou ou não pertence a este painel. Entre novamente.'
    });
  }

  var planilha = SpreadsheetApp.openById(
    '1xJPl4mFkSIgs0rv1gvzNIupHsBwYSSqJZxbdDOwZla4'
  );

  var nomeAba = abaRecebidosAdmin_(empresa);
  var aba = planilha.getSheetByName(nomeAba);

  if (!aba) {
    throw new Error('A aba ' + nomeAba + ' não foi encontrada.');
  }

  var ultimaLinha = aba.getLastRow();
  var registros = [];

  if (ultimaLinha >= 2) {

    var dados = aba
      .getRange(2, 1, ultimaLinha - 1, 18)
      .getDisplayValues();

    for (var i = 0; i < dados.length; i++) {

      if (!dados[i][0]) continue;

      registros.push({
        linha: i + 2,
        nome: dados[i][0],
        cpf: dados[i][1],
        data: dados[i][2],
        semana: dados[i][3],
        parceiro: dados[i][4],
        trampo: dados[i][5],
        valor: dados[i][6],
        por: dados[i][7],
        um: dados[i][8],
        recebedor: dados[i][9],
        recolhe: dados[i][10],
        percentualDesconto: dados[i][11],
        valorDesconto: dados[i][12],
        recolhido: dados[i][17]
      });
    }
  }

  // Busca os totais diretamente das colunas N, O, P e Q
  var totais = aba.getRange('N2:Q2').getDisplayValues()[0];

  // R2 = RECOLHIDO
  var recolhidoResumo = aba.getRange('R2').getDisplayValue() || 'R$ 0,00';

  // Dados de atendimentos e período
  // S2 = DATA INICIAL
  // T2 = DATA FINAL
  // U2 = QTDE ATENDE DIA
  // V2 = QTDE ATENDE DATAS
  var atendimentos = aba.getRange('S2:V2').getDisplayValues()[0];

var dataInicial = atendimentos[0] || '';
var dataFinal = atendimentos[1] || '';
var qtdeAtendeDia = atendimentos[2] || '0';
var qtdeAtendeDatas = atendimentos[3] || '0';

// SALDO DE CLIQUES: lê W/X e devolve somente Segunda a Sexta, sempre nesta ordem.
var diasSaldo = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
var saldoCliques = [];
var ultimaLinhaSaldo = Math.max(aba.getLastRow(), 9);
var dadosSaldo = aba.getRange(1, 23, ultimaLinhaSaldo, 2).getDisplayValues(); // W:X

for (var ds = 0; ds < diasSaldo.length; ds++) {
  var diaProcurado = diasSaldo[ds];
  var valorDia = 'R$ 0,00';
  for (var rs = 0; rs < dadosSaldo.length; rs++) {
    if (String(dadosSaldo[rs][0] || '').trim().toLowerCase() === diaProcurado.toLowerCase()) {
      valorDia = dadosSaldo[rs][1] || 'R$ 0,00';
      break;
    }
  }
  saldoCliques.push({ dia: diaProcurado, valor: valorDia });
}

var totalAds = 'R$ 0,00';
var adsPor2 = 'R$ 0,00';
for (var ts = 0; ts < dadosSaldo.length; ts++) {
  var rotuloSaldo = String(dadosSaldo[ts][0] || '').trim().toUpperCase();
  if (rotuloSaldo === 'TOTAL R$ ADS') totalAds = dadosSaldo[ts][1] || 'R$ 0,00';
  if (rotuloSaldo === 'ADS / POR 2') adsPor2 = dadosSaldo[ts][1] || 'R$ 0,00';
}

return json_({
  sucesso: true,
  autorizado: true,
  empresa: empresa,

  resumo: {
    totalRecebido: totais[0] || 'R$ 0,00',
    desconto: totais[1] || 'R$ 0,00',
    divididoPor3: totais[2] || 'R$ 0,00',
    divididoPor2: totais[3] || 'R$ 0,00',
    recolhido: recolhidoResumo,

    // ATENDIMENTOS
    dataInicial: dataInicial,
    dataFinal: dataFinal,
    qtdeAtendeDia: qtdeAtendeDia,
    qtdeAtendeDatas: qtdeAtendeDatas,
    saldoCliques: saldoCliques,
    totalAds: totalAds,
    adsPor2: adsPor2
  },

  registros: registros
});

}



/**
 * ATUALIZA SALDO DE CLIQUES NA COLUNA X.
 * Procura o dia pelo texto da COLUNA W; nunca depende de número fixo de linha.
 * Aceita exclusivamente Segunda, Terça, Quarta, Quinta e Sexta.
 */
function adminAtualizarSaldoCliques_(body) {
  var token = String(body.token || '').trim();
  var empresa = normalizarEmpresaAdmin_(body.empresa || '');
  var dia = String(body.dia || '').trim();
  var valorNormalizado = normalizarValorAdmin_(body.valor || '');
  var diasPermitidos = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

  if (!empresa || !validarAdminToken_(token, empresa)) {
    return json_({ sucesso:false, autorizado:false, mensagem:'Sua sessão expirou ou não pertence a este painel. Entre novamente.' });
  }

  var diaCorreto = '';
  for (var i = 0; i < diasPermitidos.length; i++) {
    if (diasPermitidos[i].toLowerCase() === dia.toLowerCase()) { diaCorreto = diasPermitidos[i]; break; }
  }
  if (!diaCorreto) return json_({ sucesso:false, autorizado:true, mensagem:'Dia inválido para o saldo de cliques.' });
  if (valorNormalizado === '' || Number(valorNormalizado) < 0) return json_({ sucesso:false, autorizado:true, mensagem:'Informe um valor válido.' });

  var planilha = SpreadsheetApp.openById('1xJPl4mFkSIgs0rv1gvzNIupHsBwYSSqJZxbdDOwZla4');
  var nomeAba = abaRecebidosAdmin_(empresa);
  var aba = planilha.getSheetByName(nomeAba);
  if (!aba) throw new Error('A aba ' + nomeAba + ' não foi encontrada.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ultimaLinha = Math.max(aba.getLastRow(), 9);
    var diasW = aba.getRange(1, 23, ultimaLinha, 1).getDisplayValues();
    var linhaDia = 0;
    for (var r = 0; r < diasW.length; r++) {
      if (String(diasW[r][0] || '').trim().toLowerCase() === diaCorreto.toLowerCase()) { linhaDia = r + 1; break; }
    }
    if (!linhaDia) return json_({ sucesso:false, autorizado:true, mensagem:'O dia ' + diaCorreto + ' não foi encontrado na coluna W.' });

    var celula = aba.getRange(linhaDia, 24); // X
    celula.setValue(Number(valorNormalizado));
    celula.setNumberFormat('R$ #,##0.00');
    SpreadsheetApp.flush();

    return json_({ sucesso:true, autorizado:true, dia:diaCorreto, valor:celula.getDisplayValue(), mensagem:'Saldo de ' + diaCorreto + ' atualizado com sucesso.' });
  } finally {
    lock.releaseLock();
  }
}


/**
 * ATUALIZA O CHECKBOX RECOLHE (COLUNA K) PELO PAINEL.
 * A linha é a chave principal. CPF + VALOR são conferidos antes da gravação
 * para impedir alteração do pagamento errado caso a tela esteja desatualizada.
 */
function adminAtualizarRecolhe_(body) {

  var token = String(body.token || '').trim();
  var empresa = normalizarEmpresaAdmin_(body.empresa || '');
  var linha = Number(body.linha || 0);
  var cpfEsperado = somenteNumeros_(body.cpf || '');
  var valorEsperado = normalizarValorAdmin_(body.valor || '');
  var marcado = body.marcado === true ||
                String(body.marcado || '').toLowerCase() === 'true';

  if (!empresa || !validarAdminToken_(token, empresa)) {
    return json_({
      sucesso: false,
      autorizado: false,
      mensagem: 'Sua sessão expirou ou não pertence a este painel. Entre novamente.'
    });
  }

  if (!Number.isInteger(linha) || linha < 2) {
    return json_({
      sucesso: false,
      autorizado: true,
      mensagem: 'Linha do recebimento inválida.'
    });
  }

  var planilha = SpreadsheetApp.openById(
    '1xJPl4mFkSIgs0rv1gvzNIupHsBwYSSqJZxbdDOwZla4'
  );

  var nomeAba = abaRecebidosAdmin_(empresa);
  var aba = planilha.getSheetByName(nomeAba);

  if (!aba) {
    throw new Error('A aba ' + nomeAba + ' não foi encontrada.');
  }

  if (linha > aba.getLastRow()) {
    return json_({
      sucesso: false,
      autorizado: true,
      mensagem: 'Este recebimento não existe mais na planilha. Atualize o painel.'
    });
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    // B = CPF, G = VALOR. Confere os dois antes de tocar na coluna K.
    var cpfAtual = somenteNumeros_(aba.getRange(linha, 2).getDisplayValue());
    var valorAtual = normalizarValorAdmin_(aba.getRange(linha, 7).getDisplayValue());

    if (cpfAtual !== cpfEsperado || valorAtual !== valorEsperado) {
      return json_({
        sucesso: false,
        autorizado: true,
        mensagem: 'O registro mudou na planilha. Atualize o painel antes de marcar novamente.'
      });
    }

    // K = RECOLHE
    aba.getRange(linha, 11).setValue(marcado);
    SpreadsheetApp.flush();

    // Aguarda o flush e devolve os totais já recalculados.
    var totais = aba.getRange('N2:R2').getDisplayValues()[0];

    return json_({
      sucesso: true,
      autorizado: true,
      linha: linha,
      marcado: marcado,
      resumo: {
        totalRecebido: totais[0] || 'R$ 0,00',
        desconto: totais[1] || 'R$ 0,00',
        divididoPor3: totais[2] || 'R$ 0,00',
        divididoPor2: totais[3] || 'R$ 0,00',
        recolhido: totais[4] || 'R$ 0,00'
      },
      mensagem: 'RECOLHE atualizado com sucesso.'
    });

  } finally {
    lock.releaseLock();
  }
}


/**
 * Normaliza valores monetários para comparação segura.
 * Ex.: "R$ 1.650,00" e "1.650,00" => "1650.00"
 */
function normalizarValorAdmin_(valor) {
  var s = String(valor == null ? '' : valor).trim();
  if (!s) return '';

  s = s.replace(/R\$/gi, '').replace(/\s/g, '');

  if (s.indexOf('.') !== -1 && s.indexOf(',') !== -1) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.indexOf(',') !== -1) {
    s = s.replace(',', '.');
  }

  s = s.replace(/[^0-9.-]/g, '');

  var n = Number(s);
  return isFinite(n) ? n.toFixed(2) : '';
}


/**
 * ALTERA A SENHA ADMINISTRATIVA
 * Cada painel altera somente a senha da própria empresa.
 */
function adminAlterarSenha_(body) {

  var token = String(body.token || '').trim();
  var empresa = normalizarEmpresaAdmin_(body.empresa || '');
  var senhaAtual = String(body.senhaAtual || '');
  var novaSenha = String(body.novaSenha || '');

  if (!empresa || !validarAdminToken_(token, empresa)) {
    return json_({
      sucesso: false,
      autorizado: false,
      mensagem: 'Sua sessão expirou ou não pertence a este painel. Entre novamente.'
    });
  }

  var propriedades = PropertiesService.getScriptProperties();
  var propriedadeSenha = propriedadeSenhaAdmin_(empresa);
  var senhaCorreta = propriedades.getProperty(propriedadeSenha);

  if (senhaAtual !== senhaCorreta) {
    return json_({
      sucesso: false,
      autorizado: true,
      mensagem: 'A senha atual está incorreta.'
    });
  }

  if (novaSenha.length < 6) {
    return json_({
      sucesso: false,
      autorizado: true,
      mensagem: 'A nova senha deve ter pelo menos 6 caracteres.'
    });
  }

  if (novaSenha === senhaAtual) {
    return json_({
      sucesso: false,
      autorizado: true,
      mensagem: 'A nova senha deve ser diferente da senha atual.'
    });
  }

  propriedades.setProperty(propriedadeSenha, novaSenha);

  var sessao = sessaoAdminToken_(token);
  registrarLogAdmin_(empresa, sessao ? sessao.socio : '', 'ALTERAÇÃO DE SENHA');

  return json_({
    sucesso: true,
    autorizado: true,
    empresa: empresa,
    mensagem: 'Senha alterada com sucesso.'
  });
}


/**
 * NORMALIZA NOME DO SÓCIO
 */
function normalizarSocioAdmin_(socio) {

  var s = String(socio || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!s) return '';

  return s.substring(0, 80);
}


/**
 * NORMALIZA EMPRESA ADMINISTRATIVA
 */
function normalizarEmpresaAdmin_(empresa) {

  var e = String(empresa || '').trim().toUpperCase();

  if (e === 'IPANEMA') return 'IPANEMA';
  if (e === 'ITAPEVA') return 'ITAPEVA';
  if (e === 'RECOVERY') return 'RECOVERY';
  if (e === 'ATIVOS') return 'ATIVOS';
  if (e === 'IPANEMA FIRMA') return 'IPANEMA FIRMA';

  return '';
}


function propriedadeSenhaAdmin_(empresa) {

  empresa = normalizarEmpresaAdmin_(empresa);

  if (empresa === 'IPANEMA') return 'ADMIN_PASSWORD_IPANEMA';
  if (empresa === 'ITAPEVA') return 'ADMIN_PASSWORD_ITAPEVA';
  if (empresa === 'RECOVERY') return 'ADMIN_PASSWORD_RECOVERY';
  if (empresa === 'ATIVOS') return 'ADMIN_PASSWORD_ATIVOS';
  if (empresa === 'IPANEMA FIRMA') return 'ADMIN_PASSWORD_IPANEMA_FIRMA';

  throw new Error('Empresa administrativa inválida.');
}


function abaRecebidosAdmin_(empresa) {

  empresa = normalizarEmpresaAdmin_(empresa);

  if (empresa === 'IPANEMA') return 'RECEBIDOS IPANEMA';
  if (empresa === 'ITAPEVA') return 'RECEBIDOS ITAPEVA';
  if (empresa === 'RECOVERY') return 'RECEBIDOS RECOVERY';
  if (empresa === 'ATIVOS') return 'RECEBIDOS ATIVOS';
  if (empresa === 'IPANEMA FIRMA') return 'RECEBIDOS IPANEMA FIRMA';

  throw new Error('Empresa administrativa inválida.');
}


/**
 * REGISTRA ACESSOS NA ABA LOG ADMIN
 *
 * Colunas:
 * A = DATA/HORA
 * B = EMPRESA
 * C = SÓCIO
 * D = AÇÃO
 * E = Nº ACESSO DO SÓCIO
 */
function registrarLogAdmin_(empresa, socio, acao) {

  var planilha = SpreadsheetApp.openById(
    '1xJPl4mFkSIgs0rv1gvzNIupHsBwYSSqJZxbdDOwZla4'
  );

  var aba = planilha.getSheetByName('LOG ADMIN');

  if (!aba) {
    throw new Error('A aba LOG ADMIN não foi encontrada.');
  }

  if (aba.getLastRow() === 0) {
    aba.getRange(1, 1, 1, 5).setValues([[
      'DATA/HORA',
      'EMPRESA',
      'SÓCIO',
      'AÇÃO',
      'Nº ACESSO DO SÓCIO'
    ]]);

    aba.getRange(1, 1, 1, 5).setFontWeight('bold');
  }

  var totalAcessos = contarAcessosAdmin_(aba, empresa, socio) + 1;

  aba.appendRow([
    new Date(),
    empresa,
    socio,
    acao,
    totalAcessos
  ]);
}


/**
 * CONTA QUANTOS LOGINS JÁ EXISTEM PARA O SÓCIO NA EMPRESA
 */
function contarAcessosAdmin_(aba, empresa, socio) {

  var ultimaLinha = aba.getLastRow();

  if (ultimaLinha < 2) {
    return 0;
  }

  var dados = aba
    .getRange(2, 2, ultimaLinha - 1, 3)
    .getDisplayValues();

  var total = 0;

  for (var i = 0; i < dados.length; i++) {

    var empresaLinha = String(dados[i][0] || '').trim().toUpperCase();
    var socioLinha = String(dados[i][1] || '').trim().toUpperCase();
    var acaoLinha = String(dados[i][2] || '').trim().toUpperCase();

    if (
      empresaLinha === String(empresa || '').trim().toUpperCase() &&
      socioLinha === String(socio || '').trim().toUpperCase() &&
      acaoLinha === 'LOGIN'
    ) {
      total++;
    }
  }

  return total;
}
