/**
 * =============================================================
 * MÓDULO 10: ANÁLISE DE TENDÊNCIA (v35 - COM ANÁLISE ESTATÍSTICA T-TEST)
 * (v36 - CORRIGIDO: Removidas funções duplicadas que conflituavam com Utils.gs)
 * =============================================================
 */

/**
 * FUNÇÃO 1: Abre o pop-up "Análise de Tendência" (v3)
 */
function abrirModalAnaliseMedicamento() {
  const html = HtmlService.createHtmlOutputFromFile('AnaliseMedicamento')
    .setWidth(1100)  
    .setHeight(750); // Altura corrigida para o novo layout
    
  SpreadsheetApp.getUi().showModalDialog(html, 'Configurar Análise de Intervenção');
}

/**
 * Guarda as opções de análise no cache e abre o modal do gráfico.
 * @param {object} opcoes As opções vindas do 'AnaliseMedicamento.html'
 */
function abrirModalGraficoInterativo(opcoes) {
  try {
    const cache = CacheService.getScriptCache();
    cache.put('opcoesGraficoPendente', JSON.stringify(opcoes), 300); 

    const html = HtmlService.createHtmlOutputFromFile('GraficoInterativo.html')
      .setWidth(1200) 
      .setHeight(700);
    SpreadsheetApp.getUi().showModalDialog(html, `Laboratório de Eficácia`); // Nome atualizado
    
    return { sucesso: true };
  } catch (e) {
    Logger.log("Erro em abrirModalGraficoInterativo: " + e.message);
    throw new Error("Falha ao abrir o modal do gráfico: " + e.message);
  }
}

/**
 * Esta é a função principal que busca TODOS os dados (Exames E Doses).
 */
function buscarDadosParaGrafico() {
  Logger.log(`Iniciando 'buscarDadosParaGrafico (v35)'...`);
  
  let dadosInjetados = {};
  let opcoes;

  try {
    // 1. Recupera as opções do cache
    const cache = CacheService.getScriptCache();
    const opcoesString = cache.get('opcoesGraficoPendente');
    if (!opcoesString) {
      throw new Error("Sessão expirada ou opções não encontradas. Por favor, feche e abra o configurador novamente.");
    }
    opcoes = JSON.parse(opcoesString);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // --- 2. Carregar Dados ---
    const prescricaoSheet = ss.getSheetByName(CONFIG.sheets.prescricao);
    const examesSheet = ss.getSheetByName(CONFIG.sheets.exames);
    if (!prescricaoSheet) throw new Error("Aba '" + CONFIG.sheets.prescricao + "' não encontrada.");
    if (!examesSheet) throw new Error("Aba '" + CONFIG.sheets.exames + "' não encontrada.");

    const prescricaoData = prescricaoSheet.getDataRange().getValues();
    const examesData = examesSheet.getDataRange().getValues();
    const patientMap = buildPatientMap_(); // <-- Agora usa a função do Utils.gs
    
    // Índices da Prescrição
    const hPresc = prescricaoData.shift(); // Tira o cabeçalho
    const idxPrescPront = hPresc.indexOf(CONFIG.headers.prontuario);
    const idxPrescData = hPresc.indexOf(CONFIG.headers.dataInicio);
    const idxPrescMed = hPresc.indexOf(CONFIG.headers.medicamento);
    const idxPrescTaxa = hPresc.indexOf(CONFIG.headers.colTaxaResultante); 
    
    if (idxPrescPront === -1 || idxPrescData === -1 || idxPrescMed === -1) {
      throw new Error("Colunas essenciais (Prontuário, Data Início, Medicamento) não encontradas na aba 'Prescrição de Doses'.");
    }
    if (idxPrescTaxa === -1) {
      throw new Error("Coluna '" + CONFIG.headers.colTaxaResultante + "' não encontrada na aba 'Prescrição de Doses'. Esta coluna é necessária para a sobreposição de dose.");
    }

    // Índices dos Exames
    const hExames = examesData.shift(); // Tira o cabeçalho
    const idxExamePront = hExames.indexOf(CONFIG.headers.prontuario);
    const idxExameData = hExames.indexOf(CONFIG.headers.exameData);
    const idxExameNome = hExames.indexOf(CONFIG.headers.exameNome);
    const idxExameValor = hExames.indexOf(CONFIG.headers.exameValor);
    const idxExameAnalise = hExames.indexOf(CONFIG.headers.exameAnalise); 
    const idxExameRefMin = hExames.indexOf(CONFIG.headers.exameRefMin);
    const idxExameRefMax = hExames.indexOf(CONFIG.headers.exameRefMax);
    if (idxExamePront === -1) throw new Error("Coluna '" + CONFIG.headers.prontuario + "' não encontrada na aba 'Exames'.");
    if (idxExameRefMin === -1 || idxExameRefMax === -1) {
      throw new Error("As colunas 'REF_MIN' ou 'REF_MAX' não foram encontradas na aba 'Exames'. Rode o 'Processar Análise de Exames' primeiro.");
    }
    if (idxExameAnalise === -1) {
      throw new Error("Coluna '" + CONFIG.headers.exameAnalise + "' não encontrada na aba 'Exames'. Esta coluna é necessária para o Gráfico de Proporção. Rode 'Processar Análise de Exames'.");
    }


    // --- 3. Encontrar "Dia 0" (Início da Intervenção) ---
    const pacientesAlvo = {};
    const ONE_DAY_MS = 1000 * 60 * 60 * 24;
    prescricaoData.forEach(row => {
      const prontuario = String(row[idxPrescPront] || "").trim();
      const medicamento = row[idxPrescMed];
      const dataInicio = new Date(row[idxPrescData]);
      if (medicamento === opcoes.medicamento && prontuario && !isNaN(dataInicio.getTime())) { 
        if (!pacientesAlvo[prontuario] || dataInicio.getTime() < pacientesAlvo[prontuario]) {
          pacientesAlvo[prontuario] = dataInicio.getTime(); 
        }
      }
    });

    // --- 4. Aplicar Filtros de População ---
    let prontuariosValidos = Object.keys(pacientesAlvo);
    prontuariosValidos = prontuariosValidos.filter(prontuario => {
      const patient = patientMap[prontuario];
      if (!patient) return false; 
      if (!patient.dataNasc) return false; // Ignora pacientes sem data de nascimento para o filtro de idade
      if (opcoes.filtrosPop.sexo !== 'todos' && patient.sexo !== opcoes.filtrosPop.sexo) return false;
      const éPrematuro = patient.éPrematuro;
      if (opcoes.filtrosPop.prematuridade === 'prematuro' && !éPrematuro) return false;
      if (opcoes.filtrosPop.prematuridade === 'padrao' && éPrematuro) return false;
      return true;
    });
    if (prontuariosValidos.length === 0) {
      throw new Error("Nenhum paciente encontrado para '" + opcoes.medicamento + "' que corresponda aos seus filtros (verifique se todos têm data de nascimento).");
    }

    // --- 5. Recolher dados brutos ---
    const dadosBrutosParaGrafico = [];
    
    // Loop 1: Recolher EXAMES
    examesData.forEach(row => {
      const prontuario = String(row[idxExamePront] || "").trim();
      const nomeExame = String(row[idxExameNome] || "").trim().toLowerCase();
      
      if (prontuariosValidos.includes(prontuario)) { 
        const dataExame = new Date(row[idxExameData]);
        const valor = parseFloat(row[idxExameValor]);
        const analise = row[idxExameAnalise]; 
        const refMin = parseFloat(row[idxExameRefMin]);
        const refMax = parseFloat(row[idxExameRefMax]);
        
        if (isNaN(valor) || !nomeExame || isNaN(dataExame.getTime())) return; 

        const dataIntervencao = pacientesAlvo[prontuario];
        const diasRelativos = Math.floor((dataExame.getTime() - dataIntervencao) / ONE_DAY_MS);
        const patient = patientMap[prontuario];
        
        let dataNascPacienteMs = patient.dataNasc.getTime(); // Já verificámos que não é nulo
        
        dadosBrutosParaGrafico.push({
          prontuario: prontuario,
          nomePaciente: patient.nome,
          sexo: patient.sexo,
          éPrematuro: patient.éPrematuro,
          dataNascPacienteMs: dataNascPacienteMs, 
          diasRelativos: diasRelativos,
          nomeExame: nomeExame,
          valor: valor,
          analise: analise, 
          refMin: refMin,
          refMax: refMax,
          dataExameMs: dataExame.getTime() 
        });
      }
    });
    
    // Loop 2: Recolher DOSES
    prescricaoData.forEach(row => {
      const prontuario = String(row[idxPrescPront] || "").trim();
      
      if (prontuariosValidos.includes(prontuario)) {
        const dataDose = new Date(row[idxPrescData]);
        const valorTaxa = parseFloat(row[idxPrescTaxa]);
        
        if (isNaN(valorTaxa) || isNaN(dataDose.getTime())) return;
        
        const dataIntervencao = pacientesAlvo[prontuario];
        const diasRelativos = Math.floor((dataDose.getTime() - dataIntervencao) / ONE_DAY_MS);
        const patient = patientMap[prontuario];
        let dataNascPacienteMs = patient.dataNasc.getTime();

        dadosBrutosParaGrafico.push({
          prontuario: prontuario,
          nomePaciente: patient.nome,
          sexo: patient.sexo,
          éPrematuro: patient.éPrematuro,
          dataNascPacienteMs: dataNascPacienteMs, 
          diasRelativos: diasRelativos,
          nomeExame: 'dose_intervenção', // Nome especial
          valor: valorTaxa,
          analise: 'N/A', // Dose não tem análise
          refMin: null,
          refMax: null,
          dataExameMs: dataDose.getTime() // Reutiliza o campo
        });
      }
    });
    
    if (dadosBrutosParaGrafico.length === 0) {
      throw new Error("Nenhum dado de exame ou dose correspondente foi encontrado para a população selecionada.");
    }

    // --- 6. Preparar dados para RETORNO ---
    dadosInjetados = {
      sucesso: true,
      info: {
        medicamento: opcoes.medicamento,
        configGrafico: opcoes.configGrafico
      },
      rawData: dadosBrutosParaGrafico
    };

  } catch (e) {
    Logger.log("ERRO FATAL em buscarDadosParaGrafico: " + e.message + "\nStack: " + e.stack);
    dadosInjetados = {
      sucesso: false,
      erro: e.message 
    };
  }
  
  // Retorna o objeto (sucesso ou erro) como um texto JSON
  return JSON.stringify(dadosInjetados);
}


/**
 * =============================================================
 * FUNÇÃO DE EXPORTAÇÃO
 * =============================================================
 */

function exportarDadosParaPlanilha(dadosAgregados) {
  try {
    if (!dadosAgregados || dadosAgregados.length === 0) {
      throw new Error("Não foram recebidos dados para exportar.");
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
    const nomeFolha = "Export_" + timestamp;

    let folha = ss.getSheetByName(nomeFolha);
    if (folha) {
      folha.clear(); // Limpa se por algum milagre já existir
    } else {
      folha = ss.insertSheet(nomeFolha);
    }

    // Colar os dados
    folha.getRange(1, 1, dadosAgregados.length, dadosAgregados[0].length).setValues(dadosAgregados);

    // Formatação
    folha.getRange(1, 1, 1, dadosAgregados[0].length).setFontWeight("bold").setBackground("#f4f4f4");
    folha.autoResizeColumns(1, dadosAgregados[0].length);
    folha.setFrozenRows(1);

    folha.activate();
    return { sucesso: true, nomeFolha: nomeFolha };
  } catch (e) {
    Logger.log("Erro ao exportar dados: " + e.message);
    throw new Error("Falha na exportação: " + e.message);
  }
}


/**
 * =============================================================
 * FUNÇÕES DE ESTATÍSTICA (TESTE T)
 * =============================================================
 */

/**
 * Função principal do Teste T, chamada pelo frontend.
 * @param {number[]} arrayAntes - Array de valores brutos do período "Antes".
 * @param {number[]} arrayDepois - Array de valores brutos do período "Depois".
 * @return {object} - { p, t_stat, df, interpretacao }
 */
function executarTesteT(arrayAntes, arrayDepois) {
  try {
    if (!arrayAntes || arrayAntes.length < 2 || !arrayDepois || arrayDepois.length < 2) {
      throw new Error("É necessário ter pelo menos 2 pontos de dados em CADA período ('Antes' e 'Depois') para calcular o Teste T.");
    }
    
    // 1. Calcular estatísticas para ambos os grupos
    const statsAntes = calcularEstatisticas_(arrayAntes); // <-- Agora usa a função do Utils.gs
    const statsDepois = calcularEstatisticas_(arrayDepois); // <-- Agora usa a função do Utils.gs

    // 2. Calcular o P-Value (usando Teste T de Welch, que é mais robusto)
    const resultado = calcularPValor_(statsAntes, statsDepois);
    
    // 3. Gerar interpretação
    let interpretacao = "Não significativo (p > 0.05)";
    if (resultado.p < 0.001) {
      interpretacao = "Altamente Significativo (p < 0.001)";
    } else if (resultado.p < 0.01) {
      interpretacao = "Muito Significativo (p < 0.01)";
    } else if (resultado.p < 0.05) {
      interpretacao = "Significativo (p < 0.05)";
    }

    return {
      p: resultado.p,
      t: resultado.t,
      df: resultado.df,
      interpretacao: interpretacao
    };

  } catch (e) {
    Logger.log("Erro no Teste T: " + e.message);
    throw new Error("Falha no cálculo estatístico: " + e.message);
  }
}

/**
 * Calcula o p-value usando o Teste T de Welch (não assume variâncias iguais).
 */
function calcularPValor_(stats1, stats2) {
  const n1 = stats1.n;
  const n2 = stats2.n;
  const m1 = stats1.media;
  const m2 = stats2.media;
  const v1 = stats1.variancia;
  const v2 = stats2.variancia;

  if (v1 === 0 && v2 === 0) {
    return { p: 1, t: 0, df: n1 + n2 - 2 }; // Não há variância, não há diferença
  }

  // 1. Calcular a estatística T (t-statistic)
  const t_stat = (m1 - m2) / Math.sqrt(v1/n1 + v2/n2);

  // 2. Calcular os Graus de Liberdade (df) usando a fórmula de Welch-Satterthwaite
  const df_numerator = Math.pow(v1/n1 + v2/n2, 2);
  const df_denominator = (Math.pow(v1/n1, 2) / (n1 - 1)) + (Math.pow(v2/n2, 2) / (n2 - 1));
  const df = df_numerator / df_denominator;

  // 3. Calcular o p-value (2-caudas) a partir de t e df
  const p_value = tDist2T(Math.abs(t_stat), df);

  return { p: p_value, t: t_stat, df: df };
}


// --- Funções de Suporte Matemático (Logaritmo Gamma e Beta Incompleta) ---
// Estas são funções estatísticas padrão para calcular a CDF da Distribuição T.

function gammaln(x) {
  const j = [0.9999999999998099, 676.5203681218851, -1259.1392167224028,
             771.3234287776531, -176.6150291621406, 12.507343278686905,
             -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  let y = x;
  let t = x + 5.5;
  t -= (y + 0.5) * Math.log(t);
  let ser = j[0];
  for (let i = 1; i < 9; i++) {
    ser += j[i] / ++y;
  }
  return -t + Math.log(2.5066282746310005 * ser / x);
}

function betainc(x, a, b) {
  const bt = (x === 0 || x === 1) ? 0 : Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return bt * betacf(x, a, b) / a;
  }
  return 1 - bt * betacf(1 - x, b, a) / b;
}

function betacf(x, a, b) {
  const fpmin = 1e-30;
  const m = 100;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let i = 1; i < m; i++) {
    let aa = i * (b - i) * x / ((qam + 2 * i) * (a + 2 * i));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = -(a + i) * (qab + i) * x / ((a + 2 * i) * (qap + 2 * i));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    let del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-10) break;
  }
  return h;
}

/**
 * Retorna o P-Value (2-caudas) para um T-Statistic
 */
function tDist2T(t, df) {
  const x = df / (df + t * t);
  const p = betainc(x, df / 2, 0.5);
  return p;
}
