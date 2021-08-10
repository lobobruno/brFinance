export interface LooseObject {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
}
export interface IPtax {
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
export interface ICVMCodigos {
    cnpj: string
    nome: string
    tipo: string
    codigo: string
    situacao: string
}
export interface ICotaFundo {
    cota: number
    data: number
    patrimonio: number
    cotistas: number
}
export interface IResumoEstatistico {
    futures: LooseObject[]
    buyOptions: LooseObject[]
    sellOptions: LooseObject[]
}
export interface IClassificacaoSetorial {
    setor: string
    subsetor: string
    segmento: string
    empresa: string
    codigo: string
    listSeg: string
}
