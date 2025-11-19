/**
 * =============================================================
 * MÓDULO 11: LABORATÓRIO DE PERFIL DE USO (v2.0 - Ponte Completa)
 * (O "Construtor X por Y" que substitui Protocolo e Custo)
 * =============================================================
 */

/**
 * FUNÇÃO 1: Abre o Modal do Laboratório de Perfil de Uso
 * (Chamada pelo AnaliseMedicamento.html)
 */
function abrirModalPerfilDeUso(opcoes) {
  try {
    // Guarda as opções (mapeamento) no cache
    const cache = CacheService.getScriptCache();
    cache.put('opcoesPerfilDeUso', JSON.stringify(opcoes), 300); 

    const html = HtmlService.createTemplateFromFile('PerfilDeUso.html')
      .evaluate()
      .setWidth(1000) // Mais largo para o construtor de gráficos
      .setHeight(700);
    SpreadsheetApp.getUi().showModalDialog(html, `Laboratório de Perfil de Uso`);
    
    return { sucesso: true };
  } catch (e) {
    Logger.log("Erro em abrirModalPerfilDeUso: " + e.message);
    throw new Error("Falha ao abrir o modal do Lab Perfil de Uso: " + e.message);
  }
}

/**
 * FUNÇÃO 2: O "Cérebro" - Busca e Processa os Dados para o Lab
 * (Chamada pelo PerfilDeUso.html)
 */
function buscarDadosParaPerfilDeUso() {
  Logger.log(`Iniciando 'buscarDadosParaPerfilDeUso (Motor X por Y)'...`);
  let dadosInjetados = {};
  let opcoes, mapaFatos, mapaDimensoes;
  
  try {
    // 1. Recupera as opções (Mapeamento Total) do cache
    const cache = CacheService.getScriptCache();
    const opcoesString = cache.get('opcoesPerfilDeUso');
    if (!opcoesString) {
      throw new Error("Sessão expirada. Por favor, feche e abra o configurador novamente.");
    }
    opcoes = JSON.parse(opcoesString);
    mapaFatos = opcoes.mapeamento.fatos;
    mapaDimensoes = opcoes.mapeamento.dimensoes;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // --- 2. Carregar Dados Brutos (Fatos e Dimensões) ---
    const fatosSheet = ss.getSheetByName(mapaFatos.aba);
    if (!fatosSheet) throw new Error(`Aba de Fatos '${mapaFatos.aba}' não encontrada.`);
    const fatosData = fatosSheet.getDataRange().getValues();
    const hFatos = fatosData.shift();
    // Cabeçalhos dos Fatos

    const dimensoesSheet = ss.getSheetByName(mapaDimensoes.aba);
    if (!dimensoesSheet) throw new Error(`Aba de Dimensões '${mapaDimensoes.aba}' não encontrada.`);
    const dimensoesData = dimensoesSheet.getDataRange().getValues();
    const hDimensoes = dimensoesData.shift();
    // Cabeçalhos das Dimensões
    
    // --- 3. Encontrar Índices Mapeados (Dimensões) ---
    const idxDim = {
      prontuario: hDimensoes.indexOf(mapaDimensoes.prontuario),
      // Adiciona todos os campos opcionais que queremos "juntar"
      sexo: mapaDimensoes.sexo ?
 hDimensoes.indexOf(mapaDimensoes.sexo) : -1,
      gestacao: mapaDimensoes.gestacao ?
 hDimensoes.indexOf(mapaDimensoes.gestacao) : -1,
      divisao: mapaDimensoes.divisao ? hDimensoes.indexOf(mapaDimensoes.divisao) : -1
    };
    if (idxDim.prontuario === -1) {
      throw new Error(`Coluna Prontuário ('${mapaDimensoes.prontuario}') não encontrada na aba '${mapaDimensoes.aba}'.`);
    }

    // --- 4. Encontrar Índices Mapeados (Fatos) ---
    const idxFatos = {
      prontuario: hFatos.indexOf(mapaFatos.prontuario),
      intervencao: hFatos.indexOf(mapaFatos.intervencao),
      // (Opcional) Data Início, para filtros futuros
      dataInicio: hFatos.indexOf(mapaFatos.dataInicio), 
    };
    if (idxFatos.prontuario === -1 || idxFatos.intervencao === -1) {
      throw new Error(`Colunas Prontuário ou Intervenção não encontradas na aba '${mapaFatos.aba}'.`);
    }
    
    // --- 5. Construir o Mapa de Pacientes (Apenas com os campos mapeados) ---
    Logger.log("Construindo PatientMap dinâmico para Perfil de Uso...");
    const patientMap = {};
    const colunasDinamicas = {}; // Guarda os nomes das colunas opcionais que encontrámos
    
    dimensoesData.forEach(row => {
      const prontuario = String(row[idxDim.prontuario]).trim();
      if (!prontuario) return;
      
      const patient = { prontuario: prontuario };
      
      // Adiciona campos dinâmicos (Sexo, Gestação, Divisão)
      if (idxDim.sexo !== -1) {
        patient[mapaDimensoes.sexo] = String(row[idxDim.sexo] 
 || "N/D").trim();
        colunasDinamicas[mapaDimensoes.sexo] = true;
      }
      if (idxDim.gestacao !== -1) {
        const gestStr = String(row[idxDim.gestacao] || "N/D").toLowerCase();
        patient[mapaDimensoes.gestacao] = (gestStr.includes("prematuro")) ? "Prematuro" : "Padrão/Outro";
        colunasDinamicas[mapaDimensoes.gestacao] = true;
      }
      if (idxDim.divisao !== -1) {
        patient[mapaDimensoes.divisao] = String(row[idxDim.divisao] || "N/D").trim();
        
        colunasDinamicas[mapaDimensoes.divisao] = true;
      }
      
      patientMap[prontuario] = patient;
    });

    // --- 6. Recolher *TODOS* os dados da Coorte Alvo ---
    Logger.log(`Filtrando ${fatosData.length} eventos para a intervenção '${opcoes.medicamentoAlvo}'...`);
    const dadosBrutosCoorte = [];
    
    fatosData.forEach(row => {
      const prontuario = String(row[idxFatos.prontuario] || "").trim();
      const valorIntervencao = String(row[idxFatos.intervencao] || "").trim();
      
      // Filtra pela intervenção E se o paciente existe no mapa de dimensões
      if (patientMap[prontuario] && valorIntervencao === opcoes.medicamentoAlvo) {
        
        const evento = {};
        const paciente = patientMap[prontuario];
      
   
        // A. Adiciona *TODAS* as colunas da aba Fatos (a sua query)
        hFatos.forEach((nomeColuna, i) => {
          if (nomeColuna) { // Ignora colunas vazias
            evento[nomeColuna] = row[i];
          }
        });
        
        // B. Adiciona (Junta) *TODAS* as colunas opcionais da aba Dimensões
        Object.keys(colunasDinamicas).forEach(key => {
          evento[key] = paciente[key];
        });
        
        dadosBrutosCoorte.push(evento);
      }
    });
    if (dadosBrutosCoorte.length === 0) {
      throw new Error(`Nenhum evento encontrado para a intervenção '${opcoes.medicamentoAlvo}' que também exista na aba '${mapaDimensoes.aba}'.`);
    }

    // --- 7. Preparar dados para RETORNO ---
    dadosInjetados = {
      sucesso: true,
      info: {
        medicamento: opcoes.medicamentoAlvo,
        // Envia os nomes de todas as colunas para os dropdowns "X" e "Y"
        colunas: hFatos.concat(Object.keys(colunasDinamicas)).filter(c => c) 
      },
      rawData: dadosBrutosCoorte // Envia os dados "planos" e "juntos"
    };
  } catch (e) {
    Logger.log("ERRO FATAL em buscarDadosParaPerfilDeUso: " + e.message + "\nStack: " + e.stack);
    dadosInjetados = {
      sucesso: false,
      erro: e.message 
    };
  }
  
  return JSON.stringify(dadosInjetados);
}


/**
 * =============================================================
 * FUNÇÃO 3 (ATUALIZADA): Salva o "Bloco" completo no Gabinete
 * (Chamada pelo PerfilDeUso.html)
 * =============================================================
 */
function afixarGraficoAoGabinete(blocoGraficoString) {
  try {
    const props = PropertiesService.getScriptProperties();
    const CHAVE_ESTRUTURA = 'gabineteEstrutura'; // A mesma chave do Gabinete.gs
    
    // 1. Obter a lista de blocos existente
    const estruturaSalvaString = props.getProperty(CHAVE_ESTRUTURA);
    let estruturaSalva = [];
    if (estruturaSalvaString) {
      estruturaSalva = JSON.parse(estruturaSalvaString);
    }

    // 2. Adicionar o novo bloco (que já vem 100% formatado do frontend)
    const novoBloco = JSON.parse(blocoGraficoString);
    
    // 3. Adicionar o novo bloco à lista
    estruturaSalva.push(novoBloco);

    // 4. Salvar a lista atualizada
    props.setProperty(CHAVE_ESTRUTURA, JSON.stringify(estruturaSalva));
    
    Logger.log(`Bloco de Gráfico ${novoBloco.id} afixado com sucesso. Total no gabinete: ${estruturaSalva.length}`);
    return "Gráfico afixado com sucesso!";

  } catch (e) {
    Logger.log("ERRO FATAL em afixarGraficoAoGabinete: " + e.message + "\nStack: " + e.stack);
    throw new Error("Falha ao salvar o gráfico: " + e.message);
  }
}
