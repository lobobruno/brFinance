import { IndicesAnbima } from './interfaces'
import fs from 'fs'
import path from 'path'

export interface LooseObject {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
}
export function encodeQueryData(data: LooseObject): string {
    const ret = []
    for (const d in data) {
        if (typeof data[d] === 'object') {
            for (const arrD in data[d]) {
                ret.push(`${encodeURIComponent(d)}[]=${encodeURIComponent(data[d][arrD])}`)
            }
        } else if (typeof data[d] === 'undefined') {
            ret.push(encodeURIComponent(d))
        } else {
            ret.push(`${encodeURIComponent(d)}=${encodeURIComponent(data[d])}`)
        }
    }
    return ret.join('&')
}

export function isHtml(input: string): boolean {
    return /<[a-z]+\d?(\s+[\w-]+=("[^"]*"|'[^']*'))*\s*\/?>|&#?\w+;/i.test(input)
}
export function isBrDate(input: string): boolean {
    return /^([0-2][0-9]|(3)[0-1])(\/)(((0)[0-9])|((1)[0-2]))(\/)\d{4}$/i.test(input)
}

export function toJSON(csv: string, divider = ';'): LooseObject[] {
    const lines = csv.replace(/\r/g, '').split('\n')
    const result: LooseObject[] = []
    const headers = lines[0].split(divider).map((e) =>
        e
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\W/g, ''),
    )

    lines.forEach((l) => {
        const obj: LooseObject = {}
        const line = l.split(divider)

        headers.forEach((h, i) => {
            obj[h] = line[i]
        })

        result.push(toFloatObj(obj))
    })
    result.shift()
    return result
}
export function toFixed(val: number | string, places = 5): number {
    return Number(parseFloat(val + '').toFixed(places))
}

export function toFloatObj(obj: LooseObject): LooseObject {
    const res: LooseObject = {}

    for (const key of Object.keys(obj)) {
        try {
            const parsed = toFixed(obj[key].replace(/\./g, '').replace(/\,/g, '.'), 10)
            if (!Number.isNaN(parsed)) {
                res[key] = parsed
            } else {
                res[key] = obj[key]
            }
        } catch (error) {
            res[key] = obj[key]
        }
    }
    return res
}

export function jsonToIndiceAnbima(obj: LooseObject): IndicesAnbima {
    return {
        Indice: obj.Indice,
        DatadeReferencia: obj.DatadeReferencia || null,
        NumeroIndice: obj.NumeroIndice || null,
        VariacaoDiaria: obj.VariacaoDiaria || null,
        VariacaonoMes: obj.VariacaonoMes || null,
        VariacaonoAno: obj.VariacaonoAno || null,
        Variacao12Meses: obj.Variacao12Meses || null,
        Variacao24Meses: obj.Variacao24Meses || null,
        Peso: obj.Peso || null,
        Durationdu: obj.Durationdu || null,
        CarteiraaMercadoRmil: obj.CarteiraaMercadoRmil || null,
        NumerodeOperacoes: obj.NumerodeOperacoes || null,
        QuantNegociada1000titulos: obj.QuantNegociada1000titulos || null,
        ValorNegociadoRmil: obj.ValorNegociadoRmil || null,
        PMR: obj.PMR || null,
        Convexidade: obj.Convexidade || null,
        Yield: obj.Yield || null,
        RedemptionYield: obj.RedemptionYield || null,
    }
}
export function recursivelyDelete(filePath: string): void {
    try {
        const stats = fs.statSync(filePath)
        if (stats.isFile()) {
            fs.unlinkSync(filePath)
        } else {
            const files = fs.readdirSync(filePath)
            files.forEach((file) => {
                recursivelyDelete(path.join(filePath, file))
            })
            fs.rmdirSync(filePath)
        }
    } catch (error) {}
}

export function validarCNPJ(cnpj: string): boolean {
    cnpj = cnpj.replace(/[^\d]+/g, '')
    if (cnpj == '') return false
    if (cnpj.length != 14) return false
    if (
        cnpj == '00000000000000' ||
        cnpj == '11111111111111' ||
        cnpj == '22222222222222' ||
        cnpj == '33333333333333' ||
        cnpj == '44444444444444' ||
        cnpj == '55555555555555' ||
        cnpj == '66666666666666' ||
        cnpj == '77777777777777' ||
        cnpj == '88888888888888' ||
        cnpj == '99999999999999'
    )
        return false

    // Valida DVs
    let tamanho = cnpj.length - 2
    let numeros = cnpj.substring(0, tamanho)
    const digitos = cnpj.substring(tamanho)
    let soma = 0
    let pos = tamanho - 7
    for (let i = tamanho; i >= 1; i--) {
        soma += Number(numeros.charAt(tamanho - i)) * pos--
        if (pos < 2) pos = 9
    }
    let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11)
    if (resultado !== Number(digitos.charAt(0))) return false

    tamanho = tamanho + 1
    numeros = cnpj.substring(0, tamanho)
    soma = 0
    pos = tamanho - 7
    for (let i = tamanho; i >= 1; i--) {
        soma += Number(numeros.charAt(tamanho - i)) * pos--
        if (pos < 2) pos = 9
    }
    resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11)
    if (resultado != Number(digitos.charAt(1))) return false

    return true
}
