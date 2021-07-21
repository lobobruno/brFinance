import htmlToTable from 'html-table-to-json'
import {
    encodeQueryData,
    isHtml,
    jsonToIndiceAnbima,
    recursivelyDelete,
    toFloatObj,
    toJSON,
    validarCNPJ,
} from './utils'
import { existsSync, mkdirSync } from 'fs'
import { B3Mercadoria, CodMoedaPtax, Urls } from './enums'
import { CotaFundo, CVMCodigos, IndicesAnbima, LooseObject, Ptax, ResumoEstatistico } from './interfaces'
import axios from 'axios'
import moment from 'moment'
import path from 'path'
import PromisePool from '@supercharge/promise-pool/dist'
import Xray from 'x-ray'
import { Tabletojson } from 'tabletojson'

const tmpDir = path.resolve(process.cwd(), 'downloads')

export async function obtemCodCVM(): Promise<CVMCodigos[]> {
    const { data } = await axios.request({
        method: 'GET',
        url: Urls.CVMCodigos,
        responseType: 'arraybuffer',
    })
    const xray = Xray()
    const tables: [][] = await new Promise((resolve, reject) => {
        xray(data.toString('latin1'), ['table@html'])(function (conversionError, tableHtmlList) {
            if (conversionError) {
                return reject(conversionError)
            }
            resolve(
                tableHtmlList.map(function (table: string) {
                    return Tabletojson.convert('<table>' + table + '</table>')[0]
                }),
            )
        })
    })
    if (tables.length) {
        const ret = tables[0].map((e) => ({ cnpj: e[0], nome: e[1], tipo: e[2], codigo: e[3], situacao: e[4] }))
        ret.shift()
        return ret
    }

    return []
}
/**
 * Busca Anbima
 * @param {string} startDate - Data inicial: yyyymmdd
 * @param {string} endDate - Data Final: yyyymmdd
 * @return {array} Array com os objetos da consulta
 */
export async function indicesAnbima(startDate: number, endDate: number): Promise<IndicesAnbima[]> {
    recursivelyDelete(tmpDir)
    if (!existsSync(tmpDir)) {
        mkdirSync(tmpDir)
    }
    const from = moment(startDate, 'YYYYMMDD')
    const to = moment(endDate, 'YYYYMMDD')
    if (!from.isValid() || !to.isValid()) {
        console.warn('Datas inválidas ', { startDate: startDate, endDate: endDate })
        return []
    }
    const dates: string[] = []
    const { data } = await axios.get(Urls.IndicesAnbima)
    const inputValue = data.match(/name="Dt_Ref_Ver" value="([0-9]{1,9})"/)
    if (!inputValue || !inputValue.length) return []

    const dtRef = inputValue[1]
    for (let m = moment(startDate, 'YYYYMMDD'); m.diff(to, 'days') <= 0; m.add(1, 'days')) {
        const currDt = m.format('DD/MM/YYYY') || ''
        if (currDt) dates.push(currDt)
    }
    const downloads = await PromisePool.for(dates)
        .withConcurrency(10)
        .process(async function (dt) {
            const query = encodeQueryData({
                Tipo: '',
                DataRef: '',
                Pai: 'ima',
                escolha: 2,
                Idioma: 'PT',
                saida: 'csv',
                Dt_Ref_Ver: dtRef,
                Dt_Ref: dt,
            })
            const { data } = await axios.request({
                method: 'GET',
                url: `${Urls.IndicesAnbimaDownload}?${query}`,
                responseType: 'arraybuffer',
            })
            return data.toString('latin1')
        })

    if (downloads.errors.length) console.error(downloads.errors)
    const results = downloads.results
        .filter((e) => e.indexOf('Não há dados') < 0)
        .map((e) =>
            e
                .replace(/<\/?[^>]+(>|$)/g, '')
                .replace(/--/g, '')
                .replace(/TOTAIS - QUADRO RESUMO\r{0,1}\n/g, ''),
        )
        .map((e) => toJSON(e))
        .flat()
        .filter((e) => e.Indice)
    return results.map((e) => jsonToIndiceAnbima(e))
}

/**
 * Busca cotação nas datas indicadas
 * @param {string} startDate - Data inicial: YYYYMMDD format
 * @param {string} endDate - Data Final: YYYYMMDD format
 * @param {numeric} codMoeda - Código da moeda (Default: 61 Dolar Americano)
 * @return {array} Array com os objetos da consulta
 */
export async function ptax(startDate: number, endDate: number, codMoeda = CodMoedaPtax.DOLAR_DOS_EUA): Promise<Ptax[]> {
    const from = moment(startDate, 'YYYYMMDD')
    const to = moment(endDate, 'YYYYMMDD')

    if (!from.isValid() || !to.isValid()) {
        console.warn('Datas inválidas ', { DATAINI: startDate, DATAFIM: endDate })
        return []
    }
    const userInput = {
        ChkMoeda: codMoeda,
        DATAINI: from.format('DD/MM/YYYY'),
        DATAFIM: to.format('DD/MM/YYYY'),
    }
    const urlEncoded = `${Urls.Dollar}?${encodeQueryData(
        Object.assign({ method: 'gerarCSVFechamentoMoedaNoPeriodo' }, userInput),
    )}`
    let data
    try {
        ;({ data } = await axios.get(urlEncoded))
    } catch (error) {
        console.error(error)
    }

    if (isHtml(data) || !data) {
        console.warn('Não foi encontrado dados para as entradas: ', userInput)
        return []
    }

    const lines = data
        .split('\n')
        .filter((e: string) => e.length > 0)
        .map((line: string) => {
            const [date, , type, coin, buy, sell] = line.split(';')
            const dateParts = [date.slice(4, 8), date.slice(2, 4), date.slice(0, 2)]
            return {
                data: Number(dateParts.join('')),
                tipo: type,
                moeda: coin,
                compra: buy ? Number(buy.replace(/\,/g, '.')) : 0,
                venda: sell ? Number(sell.replace(/\,/g, '.')) : 0,
            } as Ptax
        })
    return lines
}
/**
 * Busca cota de fundos de investimento
 * @param {string} cnpj - CNPJ do fundo
 * @return {array} Array com os objetos da consulta
 */
export async function cotaFundo(cnpj: string): Promise<CotaFundo[]> {
    let cotas: CotaFundo[] = []
    if (validarCNPJ(cnpj)) {
        const { data } = await axios.get(`${Urls.CotaFundos}/${cnpj}`)
        if (data && data.length)
            cotas = data.map((e: LooseObject) => ({
                cota: Number(e.c),
                data: Number(e.d),
                patrimonio: Number(e.p),
                cotistas: Number(e.q),
            }))
    } else {
        console.warn('CNPJ inválido: ', cnpj)
    }
    return cotas
}
/**
 * Get derivative stats
 * @param {number} date - Date, format: YYYYMMDD
 * @param {string} merchandise - DOL, WDO, ICF
 * @return {object} {futures: [], buyOptions: [], sellOptions: []}
 */
export async function derivativeStats(date: number, merchandise: string): Promise<ResumoEstatistico> {
    const from = moment(date + '', 'YYYYMMDD')
    const userInput = { Data: from.format('DD/MM/YYYY'), Mercadoria: merchandise }
    const isValidMerchant = Object.keys(B3Mercadoria).indexOf(merchandise.toUpperCase()) >= 0
    const isDateValid = from.isValid() || date > 19900101
    const isValid = isDateValid && isValidMerchant

    if (!isDateValid) {
        console.warn('Invalid date:', date)
    } else if (!isValidMerchant) {
        console.warn('Valid are:', B3Mercadoria)
        console.warn('Invalid Merchant:', merchandise, '\nValid above!')
    }
    if (isValid) {
        const urlEncoded = `${Urls.B3ResumoEstatistico}?${encodeQueryData(userInput)}`
        const futVars = ['MercFut0', 'MercFut1', 'MercFut2', 'MercFut3']
        const buyOptionsVars = ['MercOptComp0', 'MercOptComp1', 'MercOptComp2', 'MercOptComp3']
        const sellOptionsVars = ['MercOptVend0', 'MercOptVend1', 'MercOptVend2', 'MercOptVend3']

        try {
            const { data } = await axios.request({ method: 'GET', url: urlEncoded, responseType: 'arraybuffer' })
            const latinString = data.toString('latin1')
            return {
                futures: getJsonTable(futVars, latinString),
                buyOptions: getJsonTable(buyOptionsVars, latinString),
                sellOptions: getJsonTable(sellOptionsVars, latinString),
            }
        } catch (error) {
            console.error(error)
        }
    }
    return {
        futures: [],
        buyOptions: [],
        sellOptions: [],
    }

    function getJsonTable(vars: string[], data: string) {
        const tables = vars.map((m: string) => htmlToTable.parse(getHtmlTable(data, m).join('')))
        if (tables[3].results.length === 0)
            return getJsonTable(
                vars.map((e) => e.replace('Opt', '')),
                data,
            )
        return tables[3].results[0].map((e, i) => {
            let line = Object.assign({}, e)
            line = Object.assign(line, tables[2].results[0][i])
            line = Object.assign(line, tables[1].results[0][i])
            return toFloatObj(line)
        })
    }

    function getHtmlTable(data: string, m: string) {
        return data
            .replace(/\t/g, '')
            .replace(/\r/g, '')
            .split('\n')
            .filter((e: string) => e.indexOf(`${m} =`) >= 0)
            .filter((e: string) => e.indexOf('+') > 0)
            .map((e: string) => e.replace(`${m} = ${m} + '`, '').replace("';", ''))
    }
}
