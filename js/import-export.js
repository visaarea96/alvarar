// import-export.js

import { db } from './firebase.js';
import { onlyDigits } from './masks.js';

// Exporta dados para CSV
export function exportCSV(data, filename = 'alvaras.csv') {
    const headers = ['Tipo', 'Documento', 'Razão Social', 'Nome Fantasia', 'Endereço', 'Número', 'Bairro', 'Município', 'UF', 'CEP', 'Telefone', 'Alvará', 'Exercício', 'Validade'];
    const rows = data.map(item => [
        item.tipo,
        item.documento,
        item.razaoSocial,
        item.nomeFantasia,
        item.endereco,
        item.numero,
        item.bairro,
        item.municipio,
        item.uf,
        item.cep,
        item.telefone,
        item.alvara,
        item.exercicio,
        item.validade || ''
    ]);
    const csvContent = [headers, ...rows].map(row => row.join(';')).join('\n');
    downloadFile(csvContent, filename, 'text/csv;charset=utf-8;');
}

// Exporta dados para XLSX
export function exportXLSX(data, filename = 'alvaras.xlsx') {
    const wsData = data.map(item => ({
        'Tipo': item.tipo,
        'Documento': item.documento,
        'Razão Social': item.razaoSocial,
        'Nome Fantasia': item.nomeFantasia,
        'Endereço': item.endereco,
        'Número': item.numero,
        'Bairro': item.bairro,
        'Município': item.municipio,
        'UF': item.uf,
        'CEP': item.cep,
        'Telefone': item.telefone,
        'Alvará': item.alvara,
        'Exercício': item.exercicio,
        'Validade': item.validade || ''
    }));
    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Alvarás');
    XLSX.writeFile(wb, filename);
}

// Exporta dados para JSON
export function exportJSON(data, filename = 'alvaras.json') {
    const jsonContent = JSON.stringify(data, null, 2);
    downloadFile(jsonContent, filename, 'application/json;charset=utf-8;');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Importa arquivo CSV
export function parseCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => resolve(results.data),
            error: (error) => reject(error)
        });
    });
}

// Importa arquivo XLSX
export function parseXLSX(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const json = XLSX.utils.sheet_to_json(firstSheet);
                resolve(json);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
}

// Importa arquivo JSON
export function parseJSON(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                resolve(data);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsText(file);
    });
}

// Salva registros importados no Firestore, evitando duplicados
export async function saveImportedData(records) {
    const collectionRef = db.collection('empresas');
    const batch = db.batch();
    let imported = 0;
    let duplicates = 0;

    for (const record of records) {
        // Normaliza documento
        const tipo = record.tipo || (record.documento?.length === 14 ? 'cnpj' : 'cpf');
        const documento = onlyDigits(record.documento || '');
        if (!documento) continue;

        // Verifica duplicado
        const existing = await collectionRef.where('documento', '==', documento).where('tipo', '==', tipo).get();
        if (!existing.empty) {
            duplicates++;
            continue;
        }

        const newDoc = collectionRef.doc();
        batch.set(newDoc, {
            tipo,
            documento,
            razaoSocial: record.razaoSocial || '',
            nomeFantasia: record.nomeFantasia || '',
            endereco: record.endereco || '',
            numero: record.numero || '',
            bairro: record.bairro || '',
            municipio: record.municipio || '',
            uf: (record.uf || '').toUpperCase(),
            cep: record.cep || '',
            telefone: record.telefone || '',
            alvara: record.alvara || '',
            exercicio: record.exercicio || '',
            validade: record.validade || null,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        imported++;
    }

    await batch.commit();
    return { imported, duplicates };
}

// Gera backup completo (todos os dados)
export async function generateBackup() {
    const snapshot = await db.collection('empresas').get();
    const data = [];
    snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() });
    });
    return data;
}

// Restaura backup (substitui todos os dados)
export async function restoreBackup(data) {
    const collectionRef = db.collection('empresas');
    const batch = db.batch();
    // Exclui todos os documentos existentes
    const existing = await collectionRef.get();
    existing.forEach(doc => {
        batch.delete(doc.ref);
    });
    // Adiciona novos
    data.forEach(item => {
        const newDoc = collectionRef.doc();
        const { id, ...rest } = item;
        batch.set(newDoc, rest);
    });
    await batch.commit();
    return data.length;
}