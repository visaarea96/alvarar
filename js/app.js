// app.js

import { db } from './firebase.js';
import { consultarCNPJ } from './api.js';
import { 
    formatCNPJ, formatCPF, formatCEP, formatPhone, 
    onlyDigits, validateCNPJ, validateCPF 
} from './masks.js';
import { 
    exportCSV, exportXLSX, exportJSON, parseCSV, parseXLSX, parseJSON,
    saveImportedData, generateBackup, restoreBackup 
} from './import-export.js';

// ==================== ESTADO GLOBAL ====================
let allEmpresas = [];
let filteredEmpresas = [];
let currentPage = 1;
const pageSize = 30;
let sortField = 'documento';
let sortDirection = 'asc';
let searchTerm = '';
let filters = {
    exercicio: '',
    uf: '',
    municipio: ''
};
let empresaParaExcluir = null;

// ==================== ELEMENTOS DOM ====================
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

// ==================== INICIALIZAÇÃO ====================
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await loadData();
    renderAll();
});

async function loadData() {
    showLoading(true);
    try {
        const snapshot = await db.collection('empresas').orderBy('createdAt', 'desc').get();
        allEmpresas = [];
        snapshot.forEach(doc => {
            allEmpresas.push({ id: doc.id, ...doc.data() });
        });
        // Atualiza opções dos filtros
        updateFilterOptions();
    } catch (error) {
        showToast('Erro ao carregar dados: ' + error.message, 'error');
    } finally {
        showLoading(false);
        applyFiltersAndSort();
    }
}

function showLoading(show) {
    // Pode implementar um spinner global se necessário
    console.log(show ? 'Carregando...' : 'Carregado');
}

// ==================== RENDERIZAÇÃO ====================
function renderAll() {
    renderDashboard();
    renderTable();
    renderPagination();
    updatePageTitle();
}

function renderDashboard() {
    const total = allEmpresas.length;
    const totalAlvaras = allEmpresas.filter(e => e.alvara).length;
    const exerciciosSet = new Set(allEmpresas.map(e => e.exercicio).filter(Boolean));
    const hoje = new Date();
    const limite = new Date();
    limite.setDate(hoje.getDate() + 30);
    const proximosVenc = allEmpresas.filter(e => {
        if (!e.validade) return false;
        const venc = new Date(e.validade);
        return venc >= hoje && venc <= limite;
    }).length;

    $('#totalEmpresas').textContent = total;
    $('#totalAlvaras').textContent = totalAlvaras;
    $('#totalExercicios').textContent = exerciciosSet.size;
    $('#alvarasProximosVenc').textContent = proximosVenc;
}

function renderTable() {
    const tbody = $('#tableBody');
    const emptyState = $('#emptyState');
    tbody.innerHTML = '';

    if (filteredEmpresas.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';

    // Calcula página atual
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const pageData = filteredEmpresas.slice(start, end);

    pageData.forEach(empresa => {
        const tr = document.createElement('tr');
        
        // Coluna Documento (CNPJ/CPF)
        const docFormatted = empresa.tipo === 'cnpj' ? formatCNPJ(empresa.documento) : formatCPF(empresa.documento);
        const razaoNome = empresa.tipo === 'cnpj' ? empresa.razaoSocial : empresa.razaoSocial; // CPF usa razaoSocial como nome
        const tdDocumento = document.createElement('td');
        tdDocumento.innerHTML = `<strong>${razaoNome || 'N/A'}</strong><br><small>${docFormatted}</small>`;
        
        // Nome Fantasia
        const tdFantasia = document.createElement('td');
        tdFantasia.textContent = empresa.nomeFantasia || '—';
        
        // Endereço
        const tdEndereco = document.createElement('td');
        const enderecoCompleto = [empresa.endereco, empresa.numero, empresa.bairro, empresa.municipio, empresa.uf]
            .filter(Boolean).join(', ');
        tdEndereco.textContent = enderecoCompleto || '—';
        
        // Alvará
        const tdAlvara = document.createElement('td');
        tdAlvara.textContent = empresa.alvara || '—';
        
        // Exercício
        const tdExercicio = document.createElement('td');
        tdExercicio.textContent = empresa.exercicio || '—';
        
        // Ações
        const tdAcoes = document.createElement('td');
        tdAcoes.innerHTML = `
            <div class="actions-cell">
                <button class="action-btn view" title="Visualizar"><i class="fas fa-eye"></i></button>
                <button class="action-btn edit" title="Editar"><i class="fas fa-edit"></i></button>
                <button class="action-btn delete" title="Excluir"><i class="fas fa-trash"></i></button>
            </div>
        `;
        
        // Event listeners nas ações
        const [btnView, btnEdit, btnDelete] = tdAcoes.querySelectorAll('button');
        btnView.addEventListener('click', () => visualizarEmpresa(empresa));
        btnEdit.addEventListener('click', () => abrirModalEdicao(empresa));
        btnDelete.addEventListener('click', () => confirmarExclusao(empresa));
        
        tr.append(tdDocumento, tdFantasia, tdEndereco, tdAlvara, tdExercicio, tdAcoes);
        tbody.appendChild(tr);
    });
}

function renderPagination() {
    const totalPages = Math.ceil(filteredEmpresas.length / pageSize);
    const start = filteredEmpresas.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(start + pageSize - 1, filteredEmpresas.length);
    $('#pageInfo').textContent = `${start}–${end} de ${filteredEmpresas.length} registros`;
    $('#btnFirstPage').disabled = currentPage === 1;
    $('#btnPrevPage').disabled = currentPage === 1;
    $('#btnNextPage').disabled = currentPage === totalPages;
    $('#btnLastPage').disabled = currentPage === totalPages;
}

function updatePageTitle() {
    const page = document.querySelector('.page.active');
    if (page) {
        $('#pageTitle').textContent = page.id === 'page-dashboard' ? 'Dashboard' : 
                                      page.id === 'page-empresas' ? 'Empresas' : 
                                      page.id === 'page-importar' ? 'Importar/Exportar' : 'Backup';
    }
}

// ==================== FILTROS E ORDENAÇÃO ====================
function applyFiltersAndSort() {
    let result = [...allEmpresas];

    // Filtros simples
    if (filters.exercicio) result = result.filter(e => e.exercicio === filters.exercicio);
    if (filters.uf) result = result.filter(e => e.uf === filters.uf);
    if (filters.municipio) result = result.filter(e => e.municipio === filters.municipio);

    // Busca textual
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        result = result.filter(e => {
            const docFormatted = e.tipo === 'cnpj' ? formatCNPJ(e.documento) : formatCPF(e.documento);
            const searchStr = [
                docFormatted,
                e.documento,
                e.razaoSocial,
                e.nomeFantasia,
                e.endereco,
                e.numero,
                e.bairro,
                e.municipio,
                e.uf,
                e.cep,
                e.alvara,
                e.exercicio
            ].join(' ').toLowerCase();
            return searchStr.includes(term);
        });
    }

    // Ordenação
    result.sort((a, b) => {
        let valA = a[sortField] || '';
        let valB = b[sortField] || '';
        if (sortField === 'documento') {
            valA = onlyDigits(a.documento);
            valB = onlyDigits(b.documento);
        }
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    filteredEmpresas = result;
    currentPage = 1;
    renderTable();
    renderPagination();
}

function updateFilterOptions() {
    // Exercícios únicos
    const exercicios = [...new Set(allEmpresas.map(e => e.exercicio).filter(Boolean))].sort();
    const selectExercicio = $('#filterExercicio');
    selectExercicio.innerHTML = '<option value="">Todos os exercícios</option>';
    exercicios.forEach(ex => {
        const opt = document.createElement('option');
        opt.value = ex;
        opt.textContent = ex;
        selectExercicio.appendChild(opt);
    });

    // UFs únicas
    const ufs = [...new Set(allEmpresas.map(e => e.uf).filter(Boolean))].sort();
    const selectUF = $('#filterUF');
    selectUF.innerHTML = '<option value="">Todas as UFs</option>';
    ufs.forEach(uf => {
        const opt = document.createElement('option');
        opt.value = uf;
        opt.textContent = uf;
        selectUF.appendChild(opt);
    });

    // Municípios únicos (dependente da UF selecionada)
    const selectMunicipio = $('#filterMunicipio');
    const municipios = [...new Set(allEmpresas.map(e => e.municipio).filter(Boolean))].sort();
    selectMunicipio.innerHTML = '<option value="">Todos os municípios</option>';
    municipios.forEach(mun => {
        const opt = document.createElement('option');
        opt.value = mun;
        opt.textContent = mun;
        selectMunicipio.appendChild(opt);
    });
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    // Navegação sidebar
    $$('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = link.dataset.page;
            navigateTo(pageId);
        });
    });

    // Toggle sidebar mobile
    $('#sidebarToggle').addEventListener('click', () => {
        $('#sidebar').classList.toggle('open');
    });

    // Botão nova empresa
    $('#btnAddEmpresa').addEventListener('click', () => abrirModalNova());

    // Fechar modais
    $('#btnCloseModal').addEventListener('click', fecharModal);
    $('#btnCancelModal').addEventListener('click', fecharModal);
    $('#btnCloseConfirm').addEventListener('click', fecharModalConfirmacao);
    $('#btnCancelConfirm').addEventListener('click', fecharModalConfirmacao);

    // Confirmação de exclusão
    $('#btnConfirmDelete').addEventListener('click', excluirEmpresa);

    // Formulário de empresa
    $('#empresaForm').addEventListener('submit', salvarEmpresa);

    // Máscaras de input
    $('#tipoDocumento').addEventListener('change', handleTipoDocumentoChange);
    $('#documento').addEventListener('input', handleDocumentoInput);
    $('#documento').addEventListener('blur', handleDocumentoBlur);
    $('#cep').addEventListener('input', (e) => e.target.value = formatCEP(e.target.value));
    $('#telefone').addEventListener('input', (e) => e.target.value = formatPhone(e.target.value));

    // Busca com debounce
    let debounceTimer;
    $('#searchInput').addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchTerm = e.target.value.trim();
            applyFiltersAndSort();
        }, 300);
    });

    // Filtros
    $('#filterExercicio').addEventListener('change', (e) => {
        filters.exercicio = e.target.value;
        applyFiltersAndSort();
    });
    $('#filterUF').addEventListener('change', (e) => {
        filters.uf = e.target.value;
        applyFiltersAndSort();
    });
    $('#filterMunicipio').addEventListener('change', (e) => {
        filters.municipio = e.target.value;
        applyFiltersAndSort();
    });
    $('#btnLimparFiltros').addEventListener('click', limparFiltros);

    // Ordenação
    $$('.data-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const field = th.dataset.sort;
            if (sortField === field) {
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                sortField = field;
                sortDirection = 'asc';
            }
            // Atualiza ícones de ordenação (opcional)
            applyFiltersAndSort();
        });
    });

    // Paginação
    $('#btnFirstPage').addEventListener('click', () => { currentPage = 1; renderTable(); renderPagination(); });
    $('#btnPrevPage').addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderTable(); renderPagination(); } });
    $('#btnNextPage').addEventListener('click', () => { 
        const totalPages = Math.ceil(filteredEmpresas.length / pageSize);
        if (currentPage < totalPages) { currentPage++; renderTable(); renderPagination(); }
    });
    $('#btnLastPage').addEventListener('click', () => { 
        currentPage = Math.ceil(filteredEmpresas.length / pageSize); 
        renderTable(); 
        renderPagination(); 
    });

    // Importação
    $('#importFile').addEventListener('change', handleImportFile);
    $('#btnImport').addEventListener('click', processarImportacao);

    // Exportação
    $('#btnExportCSV').addEventListener('click', () => exportarDados('csv'));
    $('#btnExportXLSX').addEventListener('click', () => exportarDados('xlsx'));
    $('#btnExportJSON').addEventListener('click', () => exportarDados('json'));

    // Backup
    $('#btnBackup').addEventListener('click', fazerBackup);
    $('#restoreFile').addEventListener('change', handleRestoreFile);
    $('#btnRestore').addEventListener('click', processarRestauracao);
}

function navigateTo(pageId) {
    $$('.page').forEach(page => page.classList.remove('active'));
    $(`#page-${pageId}`).classList.add('active');
    $$('.nav-link').forEach(link => link.classList.remove('active'));
    document.querySelector(`.nav-link[data-page="${pageId}"]`).classList.add('active');
    updatePageTitle();
    // Fecha sidebar no mobile
    $('#sidebar').classList.remove('open');
}

// ==================== CRUD ====================
function abrirModalNova() {
    $('#empresaForm').reset();
    $('#empresaId').value = '';
    $('#modalTitle').textContent = 'Nova Empresa';
    $('#tipoDocumento').value = 'cnpj';
    handleTipoDocumentoChange();
    $('#empresaModal').style.display = 'block';
}

function abrirModalEdicao(empresa) {
    $('#empresaId').value = empresa.id;
    $('#modalTitle').textContent = 'Editar Empresa';
    $('#tipoDocumento').value = empresa.tipo;
    handleTipoDocumentoChange();
    $('#documento').value = empresa.tipo === 'cnpj' ? formatCNPJ(empresa.documento) : formatCPF(empresa.documento);
    $('#razaoSocial').value = empresa.razaoSocial || '';
    $('#nomeFantasia').value = empresa.nomeFantasia || '';
    $('#cep').value = empresa.cep ? formatCEP(empresa.cep) : '';
    $('#endereco').value = empresa.endereco || '';
    $('#numero').value = empresa.numero || '';
    $('#bairro').value = empresa.bairro || '';
    $('#municipio').value = empresa.municipio || '';
    $('#uf').value = empresa.uf || '';
    $('#telefone').value = empresa.telefone ? formatPhone(empresa.telefone) : '';
    $('#alvara').value = empresa.alvara || '';
    $('#exercicio').value = empresa.exercicio || '';
    $('#validade').value = empresa.validade || '';
    $('#empresaModal').style.display = 'block';
}

function fecharModal() {
    $('#empresaModal').style.display = 'none';
}

function visualizarEmpresa(empresa) {
    // Pode abrir um modal de visualização ou apenas mostrar os dados no formulário (readonly)
    abrirModalEdicao(empresa);
    // Desabilitar campos? Por simplicidade, apenas edição.
}

async function salvarEmpresa(e) {
    e.preventDefault();
    
    // Validações
    const tipo = $('#tipoDocumento').value;
    const documento = onlyDigits($('#documento').value);
    const razaoSocial = $('#razaoSocial').value.trim();
    const alvara = $('#alvara').value.trim();
    const exercicio = $('#exercicio').value.trim();
    const validade = $('#validade').value;

    if (!documento) {
        showToast('Documento é obrigatório.', 'error');
        return;
    }

    if (tipo === 'cnpj' && !validateCNPJ(documento)) {
        showToast('CNPJ inválido.', 'error');
        return;
    }
    if (tipo === 'cpf' && !validateCPF(documento)) {
        showToast('CPF inválido.', 'error');
        return;
    }
    if (!razaoSocial) {
        showToast('Razão Social/Nome é obrigatório.', 'error');
        return;
    }
    if (!alvara) {
        showToast('Número do alvará é obrigatório.', 'error');
        return;
    }
    if (!exercicio || exercicio.length !== 4) {
        showToast('Exercício deve ter 4 dígitos.', 'error');
        return;
    }

    const empresaData = {
        tipo,
        documento,
        razaoSocial,
        nomeFantasia: $('#nomeFantasia').value.trim(),
        cep: onlyDigits($('#cep').value),
        endereco: $('#endereco').value.trim(),
        numero: $('#numero').value.trim(),
        bairro: $('#bairro').value.trim(),
        municipio: $('#municipio').value.trim(),
        uf: $('#uf').value.trim().toUpperCase(),
        telefone: onlyDigits($('#telefone').value),
        alvara,
        exercicio,
        validade: validade || null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const id = $('#empresaId').value;
    try {
        showLoading(true);
        if (id) {
            await db.collection('empresas').doc(id).update(empresaData);
            showToast('Empresa atualizada com sucesso!', 'success');
        } else {
            empresaData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('empresas').add(empresaData);
            showToast('Empresa cadastrada com sucesso!', 'success');
        }
        fecharModal();
        await loadData();
        renderAll();
    } catch (error) {
        showToast('Erro ao salvar: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

function confirmarExclusao(empresa) {
    empresaParaExcluir = empresa;
    $('#confirmModal').style.display = 'block';
}

function fecharModalConfirmacao() {
    $('#confirmModal').style.display = 'none';
    empresaParaExcluir = null;
}

async function excluirEmpresa() {
    if (!empresaParaExcluir) return;
    try {
        await db.collection('empresas').doc(empresaParaExcluir.id).delete();
        showToast('Registro excluído.', 'success');
        fecharModalConfirmacao();
        await loadData();
        renderAll();
    } catch (error) {
        showToast('Erro ao excluir: ' + error.message, 'error');
    }
}

// ==================== MÁSCARAS E VALIDAÇÃO DE DOCUMENTO ====================
function handleTipoDocumentoChange() {
    const tipo = $('#tipoDocumento').value;
    const docInput = $('#documento');
    docInput.value = '';
    docInput.maxLength = tipo === 'cnpj' ? 18 : 14;
    docInput.placeholder = tipo === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00';
}

function handleDocumentoInput(e) {
    const tipo = $('#tipoDocumento').value;
    const formatted = tipo === 'cnpj' ? formatCNPJ(e.target.value) : formatCPF(e.target.value);
    e.target.value = formatted;
}

async function handleDocumentoBlur(e) {
    const tipo = $('#tipoDocumento').value;
    const documento = onlyDigits(e.target.value);
    if (tipo === 'cnpj' && documento.length === 14 && validateCNPJ(documento)) {
        // Consulta API automaticamente
        try {
            showLoading(true);
            const dados = await consultarCNPJ(documento);
            preencherCamposAPI(dados);
            showToast('Dados preenchidos automaticamente.', 'info');
        } catch (error) {
            showToast('Não foi possível consultar o CNPJ. Preencha manualmente.', 'error');
        } finally {
            showLoading(false);
        }
    }
}

function preencherCamposAPI(dados) {
    $('#razaoSocial').value = dados.razaoSocial || '';
    $('#nomeFantasia').value = dados.nomeFantasia || '';
    $('#cep').value = dados.cep ? formatCEP(dados.cep) : '';
    $('#endereco').value = dados.endereco || '';
    $('#numero').value = dados.numero || '';
    $('#bairro').value = dados.bairro || '';
    $('#municipio').value = dados.municipio || '';
    $('#uf').value = dados.uf || '';
    $('#telefone').value = dados.telefone || '';
}

// ==================== FILTROS ====================
function limparFiltros() {
    filters = { exercicio: '', uf: '', municipio: '' };
    searchTerm = '';
    $('#searchInput').value = '';
    $('#filterExercicio').value = '';
    $('#filterUF').value = '';
    $('#filterMunicipio').value = '';
    applyFiltersAndSort();
}

// ==================== IMPORTAÇÃO ====================
let importData = [];

function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    importData = [];
    $('#importPreview').innerHTML = '';
    $('#btnImport').disabled = true;
    
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv') {
        parseCSV(file).then(data => { importData = data; mostrarPreviewImportacao(); });
    } else if (ext === 'xlsx' || ext === 'xls') {
        parseXLSX(file).then(data => { importData = data; mostrarPreviewImportacao(); });
    } else if (ext === 'json') {
        parseJSON(file).then(data => { importData = data; mostrarPreviewImportacao(); });
    } else {
        showToast('Formato de arquivo não suportado.', 'error');
    }
}

function mostrarPreviewImportacao() {
    $('#btnImport').disabled = importData.length === 0;
    $('#importPreview').innerHTML = `
        <p><strong>${importData.length}</strong> registros encontrados para importação.</p>
        <p>Verifique os dados e clique em Importar para confirmar.</p>
    `;
}

async function processarImportacao() {
    if (importData.length === 0) return;
    $('#btnImport').disabled = true;
    try {
        showLoading(true);
        const result = await saveImportedData(importData);
        showToast(`Importação concluída: ${result.imported} importados, ${result.duplicates} duplicados ignorados.`, 'success');
        $('#importFile').value = '';
        $('#importPreview').innerHTML = '';
        await loadData();
        renderAll();
    } catch (error) {
        showToast('Erro na importação: ' + error.message, 'error');
    } finally {
        showLoading(false);
        $('#btnImport').disabled = false;
    }
}

// ==================== EXPORTAÇÃO ====================
function exportarDados(formato) {
    // Exporta os dados filtrados atualmente (filteredEmpresas)
    const dadosParaExportar = filteredEmpresas.map(emp => ({
        tipo: emp.tipo,
        documento: emp.documento,
        razaoSocial: emp.razaoSocial,
        nomeFantasia: emp.nomeFantasia,
        endereco: emp.endereco,
        numero: emp.numero,
        bairro: emp.bairro,
        municipio: emp.municipio,
        uf: emp.uf,
        cep: emp.cep,
        telefone: emp.telefone,
        alvara: emp.alvara,
        exercicio: emp.exercicio,
        validade: emp.validade
    }));

    if (dadosParaExportar.length === 0) {
        showToast('Nenhum dado para exportar.', 'error');
        return;
    }

    if (formato === 'csv') exportCSV(dadosParaExportar);
    else if (formato === 'xlsx') exportXLSX(dadosParaExportar);
    else if (formato === 'json') exportJSON(dadosParaExportar);
    showToast('Exportação iniciada.', 'success');
}

// ==================== BACKUP ====================
async function fazerBackup() {
    try {
        showLoading(true);
        const backupData = await generateBackup();
        const json = JSON.stringify(backupData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_alvaras_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Backup baixado com sucesso.', 'success');
    } catch (error) {
        showToast('Erro ao gerar backup: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

let restoreData = [];

function handleRestoreFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    restoreData = [];
    $('#restoreInfo').innerHTML = '';
    $('#btnRestore').disabled = true;
    parseJSON(file).then(data => {
        restoreData = data;
        $('#restoreInfo').innerHTML = `<p><strong>${data.length}</strong> registros encontrados no arquivo de backup.</p>`;
        $('#btnRestore').disabled = false;
    }).catch(err => {
        showToast('Arquivo inválido.', 'error');
    });
}

async function processarRestauracao() {
    if (restoreData.length === 0) return;
    if (!confirm('ATENÇÃO: Isso substituirá TODOS os dados atuais. Deseja continuar?')) return;
    $('#btnRestore').disabled = true;
    try {
        showLoading(true);
        const count = await restoreBackup(restoreData);
        showToast(`Backup restaurado com sucesso (${count} registros).`, 'success');
        $('#restoreFile').value = '';
        $('#restoreInfo').innerHTML = '';
        await loadData();
        renderAll();
    } catch (error) {
        showToast('Erro ao restaurar: ' + error.message, 'error');
    } finally {
        showLoading(false);
        $('#btnRestore').disabled = false;
    }
}

// ==================== TOAST ====================
function showToast(message, type = 'info') {
    const container = $('#toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}