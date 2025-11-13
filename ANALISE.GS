/**
 * =============================================================
 * MÓDULO 10: ANÁLISE DE TENDÊNCIA (MOTOR FASE B - MAPEAMENTO TOTAL)
 * =============================================================
 */

/**
 * FUNÇÃO 1: Abre o pop-up "Análise de Tendência"
 */
function abrirModalAnaliseMedicamento() {
  const html = HtmlService.createTemplateFromFile('AnaliseMedicamento')
    .evaluate() 
    .setWidth(1000)
    .setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(html, 'Configurar Análise de Intervenção');
}

/**
 * FUNÇÃO 1.5: Chamada pelo HTML para carregar dados de setup.
 * (Lê colunas de Fatos, Dimensões e Exames)
 */
function obterDadosParaSetupAnalise() {
  try {
    const abasParaMapear = [
      { nome: CONFIG.sheets.prescricao, prefixo: "[Prescrição]" },
      { nome: CONFIG.sheets.tabelaResumo, prefixo: "[Menu Principal]" },
      { nome: CONFIG.sheets.exames, prefixo: "[Exames]" }
    ];
    
    let colunasMapeadas = [];
    const abasDisponiveis = [];
    
    abasParaMapear.forEach(abaInfo => {
      // (Esta função deve existir no seu Utils.gs)
      const colunas = obterColunasDaAba(abaInfo.nome); 
      if (colunas.length > 0) {
        abasDisponiveis.push(abaInfo.nome);
        colunas.forEach(col => {
          colunasMapeadas.push({
            nomeAba: abaInfo.nome,
            nomeColuna: col,
            label: `${abaInfo.prefixo} - ${col}`
          });
        });
      }
    });
    
    // (Esta função deve existir no seu Utils.gs)
    const medicamentos = obterValoresUnicosDaAba_(CONFIG.sheets.prescricao, CONFIG.headers.medicamento);

    return {
      abas: abasDisponiveis, // Lista de abas que realmente existem
      colunas: colunasMapeadas, // Lista de objetos rotulados
      medicamentos: medicamentos // Lista de medicamentos da aba padrão
    };
  } catch (e) {
    Logger.log("Erro em obterDadosParaSetupAnalise: " + e.message);
    return { erro: e.message };
  }
}

/**
 * FUNÇÃO 1.6: Chamada pelo HTML para buscar valores únicos
 */
function obterValoresUnicosDaColuna(nomeAba, nomeColuna) {
  try {
    // (Esta função deve existir no seu Utils.gs)
    return obterValoresUnicosDaAba_(nomeAba, nomeColuna);
  } catch (e) {
    return { erro: e.message };
  }
}

/**
 * Guarda as opções (incluindo o mapeamento total) no cache
 */
function abrirModalGraficoInterativo(opcoes) {
  try {
    // Validação final do mapeamento antes de salvar
    if (!opcoes.medicamentoAlvo) throw new Error("Valor da Intervenção não selecionado.");
    if (!opcoes.mapeamento.fatos.aba || !opcoes.mapeamento.fatos.prontuario || !opcoes.mapeamento.fatos.dataInicio || !opcoes.mapeamento.fatos.intervencao || !opcoes.mapeamento.fatos.codigoMed || !opcoes.mapeamento.fatos.dose || !opcoes.mapeamento.fatos.unidade) {
      throw new Error("Mapeamento de Fatos (Eventos) incompleto.");
    }
    if (!opcoes.mapeamento.dimensoes.aba || !opcoes.mapeamento.dimensoes.prontuario || !opcoes.mapeamento.dimensoes.dataNasc) {
      throw new Error("Mapeamento de Dimensões (Pacientes) incompleto.");
    }
    
    const cache = CacheService.getScriptCache();
    cache.put('opcoesGraficoPendente', JSON.stringify(opcoes), 300); 

    const html = HtmlService.createTemplateFromFile('GraficoInterativo.html')
      .evaluate()
      .setWidth(1200) 
      .setHeight(700);
    SpreadsheetApp.getUi().showModalDialog(html, `Laboratório de Eficácia`);
    
    return { sucesso: true };
  } catch (e) {
    Logger.log("Erro em abrirModalGraficoInterativo: " + e.message);
    throw new Error("Falha ao abrir o modal do gráfico: " + e.message);
  }
}


/**
 * ==================================================================
 * FUNÇÃO 2 (O NOVO "CÉREBRO"): BUSCAR DADOS (MOTOR FASE B)
 * ==================================================================
 */
function buscarDadosParaGrafico() {
  Logger.log(`Iniciando 'buscarDadosParaGrafico (Motor Fase B)'...`);
  
  let dadosInjetados = {};
  let opcoes, mapaFatos, mapaDimensoes;
  
  try {
    // 1. Recupera as opções (COM MAPEAMENTO TOTAL) do cache
    const cache = CacheService.getScriptCache();
    const opcoesString = cache.get('opcoesGraficoPendente');
    if (!opcoesString) {
      throw new Error("Sessão expirada. Por favor, feche e abra o configurador novamente.");
    }
    opcoes = JSON.parse(opcoesString);
    mapaFatos = opcoes.mapeamento.fatos;
    mapaDimensoes = opcoes.mapeamento.dimensoes;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // --- 2. Carregar Dados Brutos ---
    const fatosSheet = ss.getSheetByName(mapaFatos.aba);
    if (!fatosSheet) throw new Error(`Aba de Fatos '${mapaFatos.aba}' não encontrada.`);
    const fatosData = fatosSheet.getDataRange().getValues();
    const hFatos = fatosData.shift(); // Tira cabeçalho

    const dimensoesSheet = ss.getSheetByName(mapaDimensoes.aba);
    if (!dimensoesSheet) throw new Error(`Aba de Dimensões '${mapaDimensoes.aba}' não encontrada.`);
    const dimensoesData = dimensoesSheet.getDataRange().getValues();
    const hDimensoes = dimensoesData.shift(); // Tira cabeçalho
    
    const examesSheet = ss.getSheetByName(CONFIG.sheets.exames);
    if (!examesSheet) throw new Error(`Aba '${CONFIG.sheets.exames}' não encontrada.`);
    const examesData = examesSheet.getDataRange().getValues();
    const hExames = examesData.shift();
    
    // --- 3. Carregar Mapas de Utilidade (Funções do Utils.gs) ---
    const dicionarioMap = buildDicionarioMap_();
    const weightMap = buildAndCacheWeightMap(false);
    
    // --- 4. Encontrar Índices Mapeados (Dimensões) ---
    const idxDim = {
      prontuario: hDimensoes.indexOf(mapaDimensoes.prontuario),
      dataNasc: hDimensoes.indexOf(mapaDimensoes.dataNasc),
      sexo: mapaDimensoes.sexo ? hDimensoes.indexOf(mapaDimensoes.sexo) : -1,
      gestacao: mapaDimensoes.gestacao ? hDimensoes.indexOf(mapaDimensoes.gestacao) : -1,
      divisao: mapaDimensoes.divisao ? hDimensoes.indexOf(mapaDimensoes.divisao) : -1
    };
    if (idxDim.prontuario === -1 || idxDim.dataNasc === -1) {
      throw new Error(`Colunas Prontuário ('${mapaDimensoes.prontuario}') ou Data de Nascimento ('${mapaDimensoes.dataNasc}') não encontradas na aba '${mapaDimensoes.aba}'.`);
    }

    // --- 5. Encontrar Índices Mapeados (Fatos) ---
    const idxFatos = {
      prontuario: hFatos.indexOf(mapaFatos.prontuario),
      dataInicio: hFatos.indexOf(mapaFatos.dataInicio),
      intervencao: hFatos.indexOf(mapaFatos.intervencao), // A coluna para filtrar (ex: MEDICAMENTO)
      codigoMed: hFatos.indexOf(mapaFatos.codigoMed),
      dose: hFatos.indexOf(mapaFatos.dose),
      unidade: hFatos.indexOf(mapaFatos.unidade)
    };
    if (Object.values(idxFatos).some(i => i === -1)) {
      throw new Error(`Mapeamento de Fatos incompleto. Uma ou mais colunas não foram encontradas na aba '${mapaFatos.aba}'. Verifique o mapeamento.`);
    }
    
    // --- 6. Encontrar Índices Mapeados (Exames) ---
    const idxExames = {
      prontuario: hExames.indexOf(CONFIG.headers.prontuario),
      data: hExames.indexOf(CONFIG.headers.exameData),
      nome: hExames.indexOf(CONFIG.headers.exameNome),
      valor: hExames.indexOf(CONFIG.headers.exameValor),
      analise: hExames.indexOf(CONFIG.headers.exameAnalise),
      refMin: hExames.indexOf(CONFIG.headers.exameRefMin),
      refMax: hExames.indexOf(CONFIG.headers.exameRefMax)
    };
    if (Object.values(idxExames).some(i => i === -1)) {
      throw new Error("Colunas essenciais (Prontuário, Data, Nome, Valor, etc.) não encontradas na aba 'Exames'. Rode o 'Processar Análise de Exames' primeiro.");
    }
    
    // --- 7. (APOSENTA buildPatientMap_) Construir o Mapa de Pacientes Dinâmico ---
    Logger.log("Construindo PatientMap dinâmico...");
    const patientMap = {};
    const colunasDinamicas = {}; // Para guardar os nomes das colunas de filtro (ex: "Sexo")
    
    dimensoesData.forEach(row => {
      const prontuario = String(row[idxDim.prontuario]).trim();
      if (!prontuario) return;
      
      let dataNasc = null;
      try { dataNasc = new Date(row[idxDim.dataNasc]); } catch (e) {}
      
      const patient = {
        prontuario: prontuario,
        dataNasc: dataNasc,
      };
      
      // Adiciona campos dinâmicos (Sexo, Gestação, Divisão)
      if (idxDim.sexo !== -1) {
        const nomeColuna = mapaDimensoes.sexo; // Ex: "SEXO"
        patient[nomeColuna] = String(row[idxDim.sexo] || "N/D").trim();
        colunasDinamicas[nomeColuna] = true;
      }
      if (idxDim.gestacao !== -1) {
        const nomeColuna = mapaDimensoes.gestacao; // Ex: "IDADE GESTACIONAL"
        const gestStr = String(row[idxDim.gestacao] || "N/D").toLowerCase();
        patient[nomeColuna] = (gestStr.includes("prematuro")) ? "Prematuro" : "Padrão/Outro";
        colunasDinamicas[nomeColuna] = true;
      }
      if (idxDim.divisao !== -1) {
        const nomeColuna = mapaDimensoes.divisao; // Ex: "FABRICANTE"
        patient[nomeColuna] = String(row[idxDim.divisao] || "N/D").trim();
        colunasDinamicas[nomeColuna] = true;
      }
      
      patientMap[prontuario] = patient;
    });
    Logger.log(`PatientMap dinâmico construído com ${Object.keys(patientMap).length} pacientes.`);
    
    // --- 8. Encontrar "Dia 0" (Início da Intervenção) ---
    const pacientesAlvo = {};
    const ONE_DAY_MS = 1000 * 60 * 60 * 24;
    
    fatosData.forEach(row => {
      const prontuario = String(row[idxFatos.prontuario] || "").trim();
      const valorIntervencao = String(row[idxFatos.intervencao] || "").trim();
      const dataInicio = new Date(row[idxFatos.dataInicio]);
      
      // Verifica se a linha é do paciente E da intervenção-alvo
      if (patientMap[prontuario] && valorIntervencao === opcoes.medicamentoAlvo && !isNaN(dataInicio.getTime())) { 
        if (!pacientesAlvo[prontuario] || dataInicio.getTime() < pacientesAlvo[prontuario]) {
          pacientesAlvo[prontuario] = dataInicio.getTime(); // Salva o Timestamp do "Dia 0"
        }
      }
    });
    
    const prontuariosValidos = Object.keys(pacientesAlvo);
    if (prontuariosValidos.length === 0) {
      throw new Error(`Nenhum paciente encontrado para a intervenção '${opcoes.medicamentoAlvo}' que também exista na aba '${mapaDimensoes.aba}'.`);
    }

    // --- 9. Recolher dados brutos (Exames e Doses) ---
    const dadosBrutosParaGrafico = [];
    
    // Loop 1: Recolher EXAMES
    examesData.forEach(row => {
      const prontuario = String(row[idxExames.prontuario] || "").trim();
      
      if (pacientesAlvo[prontuario]) { // Se este paciente está na nossa coorte
        const dataExame = new Date(row[idxExames.data]);
        const valor = parseFloat(row[idxExames.valor]);
        if (isNaN(valor) || isNaN(dataExame.getTime())) return; 

        const patient = patientMap[prontuario];
        const dataIntervencao = pacientesAlvo[prontuario];
        const diasRelativos = Math.floor((dataExame.getTime() - dataIntervencao) / ONE_DAY_MS);
        
        const dataPoint = {
          prontuario: prontuario,
          dataNascPacienteMs: patient.dataNasc ? patient.dataNasc.getTime() : null,
          diasRelativos: diasRelativos,
          nomeExame: String(row[idxExames.nome] || "N/D").trim().toLowerCase(),
          valor: valor,
          analise: row[idxExames.analise],
          refMin: parseFloat(row[idxExames.refMin]),
          refMax: parseFloat(row[idxExames.refMax]),
          dataExameMs: dataExame.getTime() 
        };
        
        // Adiciona dinamicamente os campos de dimensão (Sexo, Divisão, etc.)
        Object.keys(colunasDinamicas).forEach(key => {
          dataPoint[key] = patient[key];
        });
        
        dadosBrutosParaGrafico.push(dataPoint);
      }
    });
    
    // Loop 2: Recolher DOSES (Cálculo "On-the-fly")
    fatosData.forEach(row => {
      const prontuario = String(row[idxFatos.prontuario] || "").trim();
      
      if (pacientesAlvo[prontuario]) { // Se este paciente está na nossa coorte
        const dataDose = new Date(row[idxFatos.dataInicio]);
        const codigoMed = String(row[idxFatos.codigoMed] || "").trim();
        const doseValor = parseFloat(row[idxFatos.dose]);
        const doseUnidade = String(row[idxFatos.unidade] || "").trim().toUpperCase();

        if (isNaN(doseValor) || !codigoMed || !doseUnidade || isNaN(dataDose.getTime())) return;
        
        const chaveDicionario = `${codigoMed}_${doseUnidade}`;
        const regra = dicionarioMap[chaveDicionario];
        if (!regra) {
          throw new Error(`Regra não encontrada no DICIONÁRIO_MEDICAMENTOS para: CÓDIGO=${codigoMed}, UNIDADE=${doseUnidade}.`);
        }
        
        const doseEmMg = doseValor * regra.fatorConversao;
        const peso = findLatestWeightOptimized(prontuario, dataDose); // Do Utils.gs
        const valorTaxa = (peso && peso > 0) ? (doseEmMg / peso) : null;
        
        if (valorTaxa === null) return; // Não plota se não achou peso
        
        const patient = patientMap[prontuario];
        const dataIntervencao = pacientesAlvo[prontuario];
        const diasRelativos = Math.floor((dataDose.getTime() - dataIntervencao) / ONE_DAY_MS);
        
        const dataPoint = {
          prontuario: prontuario,
          dataNascPacienteMs: patient.dataNasc ? patient.dataNasc.getTime() : null,
          diasRelativos: diasRelativos,
          nomeExame: 'dose_intervenção',
          valor: valorTaxa,
          analise: 'N/A',
          refMin: null,
          refMax: null,
          dataExameMs: dataDose.getTime()
        };
        
        // Adiciona dinamicamente os campos de dimensão (Sexo, Divisão, etc.)
        Object.keys(colunasDinamicas).forEach(key => {
          dataPoint[key] = patient[key];
        });
        
        dadosBrutosParaGrafico.push(dataPoint);
      }
    });
    
    if (dadosBrutosParaGrafico.length === 0) {
      throw new Error("Nenhum dado de exame ou dose correspondente foi encontrado para a população selecionada.");
    }

    // --- 10. Preparar dados para RETORNO ---
    dadosInjetados = {
      sucesso: true,
      info: {
        medicamento: opcoes.medicamentoAlvo,
        // Envia as colunas de filtro que foram mapeadas
        colunasFiltro: Object.keys(colunasDinamicas) 
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
      folha.clear();
    } else {
      folha = ss.insertSheet(nomeFolha);
    }

    folha.getRange(1, 1, dadosAgregados.length, dadosAgregados[0].length).setValues(dadosAgregados);
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
 * @param {Array<object>} arraysParaTestar - Array de objetos { nome, antes: [], depois: [] }
 * @return {Array<object>} - Array de resultados { nome, p, t, df, ... }
 */
function executarTesteTMultiCoorte(arraysParaTestar) {
  const resultadosFinais = [];

  arraysParaTestar.forEach(coorte => {
    try {
      const arrayAntes = coorte.antes;
      const arrayDepois = coorte.depois;

      if (!arrayAntes || arrayAntes.length < 2 || !arrayDepois || arrayDepois.length < 2) {
        throw new Error("É necessário ter pelo menos 2 pontos de dados em CADA período.");
      }
      
      const statsAntes = calcularEstatisticas_(arrayAntes); // Do Utils.gs
      const statsDepois = calcularEstatisticas_(arrayDepois); // Do Utils.gs

      const resultado = calcularPValor_(statsAntes, statsDepois);

      let interpretacao = "Não significativo (p > 0.05)";
      if (resultado.p < 0.001) {
        interpretacao = "Altamente Significativo (p < 0.001)";
      } else if (resultado.p < 0.01) {
        interpretacao = "Muito Significativo (p < 0.01)";
      } else if (resultado.p < 0.05) {
        interpretacao = "Significativo (p < 0.05)";
      }

      resultadosFinais.push({
        nome: coorte.nome,
        p: resultado.p,
        t: resultado.t,
        df: resultado.df,
        interpretacao: interpretacao,
        mediaAntes: statsAntes.media,
        nAntes: statsAntes.n,
        mediaDepois: statsDepois.media,
        nDepois: statsDepois.n
      });

    } catch (e) {
      Logger.log(`Erro no Teste T para ${coorte.nome}: ${e.message}`);
      resultadosFinais.push({
        nome: coorte.nome,
        erro: e.message
      });
    }
  });
  
  return resultadosFinais;
}

/**
 * Calcula o p-value usando o Teste T de Welch.
 */
function calcularPValor_(stats1, stats2) {
  const n1 = stats1.n;
  const n2 = stats2.n;
  const m1 = stats1.media;
  const m2 = stats2.media;
  const v1 = stats1.variancia;
  const v2 = stats2.variancia;
  
  if (v1 === null || v2 === null) throw new Error("Variância nula recebida.");
  if (v1 === 0 && v2 === 0 && m1 === m2) {
    return { p: 1, t: 0, df: n1 + n2 - 2 }; // Sem variância, médias iguais
  }
  if (v1 === 0 && v2 === 0 && m1 !== m2) {
    return { p: 0, t: Infinity, df: n1 + n2 - 2 }; // Sem variância, médias diferentes
  }
  
  // Evita divisão por zero se n=1
  if (n1 < 2 || n2 < 2) {
     throw new Error("Não é possível calcular Teste T com n < 2.");
  }

  const t_stat = (m1 - m2) / Math.sqrt(v1/n1 + v2/n2);
  const df_numerator = Math.pow(v1/n1 + v2/n2, 2);
  const df_denominator = (Math.pow(v1/n1, 2) / (n1 - 1)) + (Math.pow(v2/n2, 2) / (n2 - 1));
  const df = df_numerator / df_denominator;
  
  const p_value = tDist2T(Math.abs(t_stat), df);
  return { p: p_value, t: t_stat, df: df };
}


// --- Funções de Suporte Matemático (Logaritmo Gamma e Beta Incompleta) ---
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
  const bt = (x === 0 || x === 1) ?
  0 : Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
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
