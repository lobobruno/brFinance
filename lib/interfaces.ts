export interface Ptax {
    data: number
    tipo: string
    moeda: string
    compra: number
    venda: number
}

export interface IndicesAnbima {
    Indice: string | null
    DatadeReferencia: number | null
    NumeroIndice: number | null
    VariacaoDiaria: number | null
    VariacaonoMes: number | null
    VariacaonoAno: number | null
    Variacao12Meses: number | null
    Variacao24Meses: number | null
    Peso: number | null
    Durationdu: number | null
    CarteiraaMercadoRmil: number | null
    NumerodeOperacoes: number | null
    QuantNegociada1000titulos: number | null
    ValorNegociadoRmil: number | null
    PMR: number | null
    Convexidade: number | null
    Yield: number | null
    RedemptionYield: number | null
}
export interface CVMCodigos {
    cnpj: string
    nome: string
    tipo: string
    codigo: string
    situacao: string
}
