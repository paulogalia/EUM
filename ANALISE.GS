/**
 * =============================================================
 * MÓDULO 10: ANÁLISE DE TENDÊNCIA (v23 - PASSO DE ADIÇÃO 1)
 * =============================================================
 */

/**
 * FUNÇÃO 1: Abre o pop-up "Análise de Tendência" (v3)
 */
function abrirModalAnaliseMedicamento() {
  const html = HtmlService.createHtmlOutputFromFile('AnaliseMedicamento')
    .setWidth(1100)  
    .setHeight(650); // Altura ajustada para o novo HTML (v10)
    
  SpreadsheetApp.getUi().showModalDialog(html, 'Configurar Análise de Intervenção');
}

/**
 * FUNÇÃO 2: Pega a lista de medicamentos (Helper)
 */
function obterListaDeMedicamentosUnicos() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.sheets.prescricao);
    if (!sheet) throw new Error("Aba '" + CONFIG.sheets.prescricao + "' não encontrada.");
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idxMed = headers.indexOf(CONFIG.headers.medicamento);
    if (idxMed === -1) {
      throw new Error("Coluna '" + CONFIG.headers.medicamento + "' não encontrada.");
    }
    const data = sheet.getRange(2, idxMed + 1, sheet.getLastRow() - 1, 1).getValues();
    const unicos = [...new Set(data.map(row => row[0]))].filter(med => med); 
    return unicos;
  } catch (e) {
    Logger.log("Erro em obterListaDeMedicamentosUnicos: " + e.message);
    throw e;
  }
}

/**
 * FUNÇÃO 3 (O MOTOR): Recolhe TODOS os dados brutos da população filtrada.
 * (v23 - Corrige bugs de tipo de dados e idade null)
 */
function recolherDadosParaLaboratorio(opcoes) {
  const ui = SpreadsheetApp.getUi();
  Logger.log(`Iniciando 'recolherDadosParaLaboratorio (v23)' para ${opcoes.medicamento}`);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // --- 1. Carregar Dados ---
    const prescricaoSheet = ss.getSheetByName(CONFIG.sheets.prescricao);
    const examesSheet = ss.getSheetByName(CONFIG.sheets.exames);
    if (!prescricaoSheet) throw new Error("Aba '" + CONFIG.sheets.prescricao + "' não encontrada.");
    if (!examesSheet) throw new Error("Aba '" + CONFIG.sheets.exames + "' não encontrada.");

    const prescricaoData = prescricaoSheet.getDataRange().getValues();
    const examesData = examesSheet.getDataRange().getValues();
    
    const patientMap = buildPatientMap_(); // Do helper colado abaixo
    
    const hPresc = prescricaoData.shift();
    const idxPrescPront = hPresc.indexOf(CONFIG.headers.prontuario);
    const idxPrescData = hPresc.indexOf(CONFIG.headers.dataInicio);
    const idxPrescMed = hPresc.indexOf(CONFIG.headers.medicamento);
    
    const hExames = examesData.shift();
    const idxExamePront = hExames.indexOf(CONFIG.headers.prontuario);
    const idxExameData = hExames.indexOf(CONFIG.headers.exameData);
    const idxExameNome = hExames.indexOf(CONFIG.headers.exameNome);
    const idxExameValor = hExames.indexOf(CONFIG.headers.exameValor);
    const idxExameAnalise = hExames.indexOf(CONFIG.headers.exameAnalise); 
    const idxExameRefMin = hExames.indexOf(CONFIG.headers.exameRefMin);
    const idxExameRefMax = hExames.indexOf(CONFIG.headers.exameRefMax);
    if (idxExameRefMin === -1 || idxExameRefMax === -1) {
      throw new Error("As colunas 'REF_MIN' ou 'REF_MAX' não foram encontradas na aba 'Exames'. Rode o 'Processar Análise de Exames' primeiro.");
    }

    // --- 2. Encontrar "Dia 0" para TODOS os pacientes ---
    const pacientesAlvo = {};
    const ONE_DAY_MS = 1000 * 60 * 60 * 24;
    
    prescricaoData.forEach(row => {
      const prontuario = String(row[idxPrescPront] || "").trim(); // Força String
      const medicamento = row[idxPrescMed];
      const dataInicio = new Date(row[idxPrescData]);
      if (medicamento === opcoes.medicamento && prontuario) { 
        if (!pacientesAlvo[prontuario] || dataInicio < pacientesAlvo[prontuario]) {
          pacientesAlvo[prontuario] = dataInicio.getTime(); 
        }
      }
    });

    // --- 3. Aplicar Filtros de População ---
    let prontuariosValidos = Object.keys(pacientesAlvo);
    prontuariosValidos = prontuariosValidos.filter(prontuario => {
      const patient = patientMap[prontuario];
      if (!patient) return false; 
      if (opcoes.filtrosPop.sexo !== 'todos' && patient.sexo !== opcoes.filtrosPop.sexo) return false;
      const éPrematuro = patient.éPrematuro;
      if (opcoes.filtrosPop.prematuridade === 'prematuro' && !éPrematuro) return false;
      if (opcoes.filtrosPop.prematuridade === 'padrao' && éPrematuro) return false;
      return true;
    });

    if (prontuariosValidos.length === 0) {
      throw new Error("Nenhum paciente encontrado para '" + opcoes.medicamento + "' que corresponda aos seus filtros.");
    }
    Logger.log(`Analisando ${prontuariosValidos.length} pacientes após filtros.`);

    // --- 4. Recolher TODOS os dados brutos ---
    const dadosBrutosParaGrafico = [];

    examesData.forEach(row => {
      const prontuario = String(row[idxExamePront] || "").trim(); // Força String
      const nomeExame = String(row[idxExameNome] || "").trim().toLowerCase();
      
      // Recolhe TODOS os exames para os pacientes válidos
      if (prontuariosValidos.includes(prontuario)) { 
        
        const dataExame = new Date(row[idxExameData]);
        const valor = parseFloat(row[idxExameValor]);
        const analise = row[idxExameAnalise]; 
        const refMin = parseFloat(row[idxExameRefMin]);
        const refMax = parseFloat(row[idxExameRefMax]);
        
        if (isNaN(valor)) return; 
        if (!nomeExame) return; 

        const dataIntervencao = pacientesAlvo[prontuario];
        const diasRelativos = Math.floor((dataExame.getTime() - dataIntervencao) / ONE_DAY_MS);
        const patient = patientMap[prontuario];
        
        let idadeEmDias = null;
        try {
          if (patient.dataNasc && !isNaN(patient.dataNasc.getTime())) {
             idadeEmDias = Math.floor((dataExame.getTime() - patient.dataNasc.getTime()) / ONE_DAY_MS);
          }
        } catch (e) {}
        
        dadosBrutosParaGrafico.push({
          prontuario: prontuario,
          nomePaciente: patient.nome,
          sexo: patient.sexo,
          éPrematuro: patient.éPrematuro,
          idadeEmDias: idadeEmDias, 
          diasRelativos: diasRelativos,
          nomeExame: nomeExame,
          valor: valor,
          analise: analise, 
          refMin: refMin,
          refMax: refMax,
          dataExame: dataExame.toLocaleDateString('pt-BR')
        });
      }
    });
    
    if (dadosBrutosParaGrafico.length === 0) {
      throw new Error("Nenhum dado de exame correspondente foi encontrado para a população selecionada.");
    }

    // --- 5. Preparar dados e abrir o "Laboratório" ---
    const dadosInjetados = {
      info: {
        medicamento: opcoes.medicamento,
        configGrafico: opcoes.configGrafico // Passa as opções do gráfico
      },
      rawData: dadosBrutosParaGrafico
    };

    const template = HtmlService.createTemplateFromFile("GraficoInterativo.html");
    template.dadosBrutos = JSON.stringify(dadosInjetados);
    
    const htmlOutput = template.evaluate()
      .setWidth(1200) 
      .setHeight(700);
      
    ui.showModalDialog(htmlOutput, `Laboratório Interativo: ${opcoes.medicamento}`);
    
    return "Sucesso";

  } catch (e) {
    Logger.log("ERRO FATAL em recolherDadosParaLaboratorio: " + e.message + "\nStack: " + e.stack);
    ui.alert("Erro no Script", "Ocorreu um erro: " + e.message, ui.ButtonSet.OK);
    throw e; 
  }
}

// =============================================================
// FUNÇÕES HELPER (COLADAS AQUI PARA SER AUTOSSUFICIENTE)
// =============================================================

/**
 * HELPER 1: Constrói o mapa de dados dos pacientes da 'TABELA'.
 */
function buildPatientMap_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabelaSheet = ss.getSheetByName(CONFIG.sheets.tabelaResumo);
  if (!tabelaSheet) throw new Error("Aba '" + CONFIG.sheets.tabelaResumo + "' não encontrada.");
  const data = tabelaSheet.getDataRange().getValues();
  const headers = data.shift(); 
  const idx = {
    prontuario: headers.indexOf(CONFIG.headers.prontuario),
    nome: headers.indexOf(CONFIG.headers.nomePaciente), 
    dataNasc: headers.indexOf(CONFIG.headers.dataNascimento),
    gestacao: headers.indexOf(CONFIG.headers.gestacao),
    sexo: headers.indexOf(CONFIG.headers.sexo)
  };
  if (idx.prontuario === -1 || idx.dataNasc === -1 || idx.sexo === -1 || idx.nome === -1) {
    throw new Error(`A aba '${CONFIG.sheets.tabelaResumo}' deve conter todas estas colunas (verifique o CONFIG): '${CONFIG.headers.prontuario}', '${CONFIG.headers.dataNascimento}', '${CONFIG.headers.sexo}' e '${CONFIG.headers.nomePaciente}'.`);
  }
  const gestacaoColumnExists = idx.gestacao !== -1;
  const map = {};
  data.forEach(row => {
    const prontuario = String(row[idx.prontuario]).trim(); // <-- Força String
    if (!prontuario) return;
    let dataNasc = null;
    try {
      const dataVal = row[idx.dataNasc];
      if (dataVal) dataNasc = new Date(dataVal);
    } catch (e) {}
    let sexo = String(row[idx.sexo] || "").toUpperCase().charAt(0);
    if (sexo !== "M" && sexo !== "F") sexo = null; 
    let nome = row[idx.nome] || "Sem Nome";
    let éPrematuro = false;
    let semanasGestao = 40; 
    if (gestacaoColumnExists) {
      const gestacaoStr = String(row[idx.gestacao] || "").toLowerCase();
      if (gestacaoStr.includes("prematuro")) {
        éPrematuro = true;
        const match = gestacaoStr.match(/(\d+)\s*sem(ana|anas)?/);
        if (match) semanasGestao = parseInt(match[1], 10);
        else éPrematuro = false;
      }
    }
    map[prontuario] = {
      nome: nome,
      dataNasc: dataNasc,
      éPrematuro: éPrematuro,
      semanasGestao: semanasGestao,
      sexo: sexo
    };
  });
  return map;
}

/**
 * HELPER 2: Calcula a média E o Desvio Padrão.
 */
function calcularEstatisticas_(arr) {
  if (!arr || arr.length === 0) {
    return { media: null, n: 0, stdDev: null };
  }
  const n = arr.length;
  const sum = arr.reduce((a, b) => a + b, 0);
  const media = sum / n;
  if (n === 1) {
    return { media: media, n: 1, stdDev: 0 }; 
  }
  const variancia = arr.map(x => Math.pow(x - media, 2)).reduce((a, b) => a + b, 0) / (n - 1);
  const stdDev = Math.sqrt(variancia);
  return {
    media: media,
    n: n,
    stdDev: stdDev
  };
}