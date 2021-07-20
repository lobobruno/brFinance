import { encodeQueryData, isHtml, jsonToIndiceAnbima, recursivelyDelete, toJSON } from './utils'
import { existsSync, mkdirSync } from 'fs'
import { CodMoedaPtax, Urls } from './enums'
import { CVMCodigos, IndicesAnbima, Ptax } from './interfaces'
import { browser } from './browser'
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
    const page = await browser.goTo(Urls.IndicesAnbima)
    const dtRef = await page.$eval("input[name='Dt_Ref_Ver']", (el) => (el as HTMLInputElement).value)
    for (let m = moment(startDate, 'YYYYMMDD'); m.diff(to, 'days') <= 0; m.add(1, 'days')) {
        const currDt = m.format('DD/MM/YYYY') || ''
        if (currDt) dates.push(currDt)
    }
    const downloads = await PromisePool.for(dates)
        .withConcurrency(5)
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
