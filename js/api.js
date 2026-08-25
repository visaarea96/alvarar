// api.js

// Consulta dados da empresa pelo CNPJ usando BrasilAPI
export async function consultarCNPJ(cnpj) {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    if (cnpjLimpo.length !== 14) {
        throw new Error('CNPJ inválido');
    }
    try {
        const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);
        if (!response.ok) {
            throw new Error('CNPJ não encontrado');
        }
        const data = await response.json();
        return {
            razaoSocial: data.razao_social,
            nomeFantasia: data.nome_fantasia || '',
            endereco: data.logradouro || '',
            numero: data.numero || '',
            bairro: data.bairro || '',
            municipio: data.municipio || '',
            uf: data.uf || '',
            cep: data.cep || '',
            telefone: data.ddd_telefone_1 ? `(${data.ddd_telefone_1}) ${data.telefone_1}` : ''
        };
    } catch (error) {
        throw new Error('Erro ao consultar CNPJ: ' + error.message);
    }
}