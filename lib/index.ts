import htmlToTable from 'html-table-to-json'
import {
    cleanString,
    encodeQueryData,
    isHtml,
    jsonToIndiceAnbima,
    recursivelyDelete,
    toFloatObj,
    toJSON,
    validarCNPJ,
} from './utils'
import { existsSync, mkdirSync } from 'fs'
import { B3Index, B3Mercadoria, CodMoedaPtax, Urls } from './enums'
import {
    ICotaFundo,
    ICVMCodigos,
    IIndicesAnbima,
    LooseObject,
    IPtax,
    IResumoEstatistico,
    IClassificacaoSetorial,
    IIBOVComposicao,
    ICarteira,
} from './interfaces'
import axios from 'axios'
import moment from 'moment'
import path from 'path'
import PromisePool from '@supercharge/promise-pool/dist'
import Xray from 'x-ray'
import { Tabletojson } from 'tabletojson'
import XLSX from 'XLSX'
import { downloadFile, unzip } from './utils'
import https from 'https'

const tmpDir = path.resolve(process.cwd(), 'downloads')

export async function obtemCodCVM(): Promise<ICVMCodigos[]> {
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
export async function indicesAnbima(startDate: number, endDate: number): Promise<IIndicesAnbima[]> {
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
export async function ptax(
    startDate: number,
    endDate: number,
    codMoeda = CodMoedaPtax.DOLAR_DOS_EUA,
): Promise<IPtax[]> {
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
            } as IPtax
        })
    return lines
}
/**
 * Busca cota de fundos de investimento
 * @param {string} cnpj - CNPJ do fundo
 * @return {array} Array com os objetos da consulta
 */
export async function cotaFundo(cnpj: string): Promise<ICotaFundo[]> {
    let cotas: ICotaFundo[] = []
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
export async function derivativeStats(date: number, merchandise: string): Promise<IResumoEstatistico> {
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

/**
 * Get industry classification
  @param {string} downloadDir - Tmp download dir
 * @return {array} {setor, subsetor, segmento, codigo, listaSeg}
 */
export async function getIndustryClassification(downloadDir?: string): Promise<IClassificacaoSetorial[]> {
    const parseSectorXlsx = (filePath: string) => {
        const workbook = XLSX.readFile(filePath)
        const sheet_name_list = workbook.SheetNames
        let setor = ''
        let subsetor = ''
        let segmento = ''

        const companies: IClassificacaoSetorial[] = []
        sheet_name_list.forEach(function (y) {
            const worksheet = workbook.Sheets[y]
            for (const z in worksheet) {
                if (z[0] === '!') continue
                let tt = 0
                for (let i = 0; i < z.length; i++) {
                    if (!Number.isNaN(Number(z[i]))) {
                        tt = i
                        break
                    }
                }
                const col = z.substring(0, tt)
                const row = parseInt(z.substring(tt))
                if (row >= 9) {
                    const value = worksheet[z].v
                    setor =
                        col === 'A' && value && cleanString(value) !== cleanString('SETOR ECONÔMICO')
                            ? value.trim()
                            : setor
                    subsetor = col === 'B' && value && value.trim() !== 'SUBSETOR' ? value : subsetor
                    segmento =
                        col === 'C' && value && value !== 'SEGMENTO' && worksheet['D' + row] === undefined
                            ? value.trim()
                            : segmento
                    //store header names
                    if (col === 'C' && value && worksheet['D' + row] && worksheet['D' + row].v !== 'LISTAGEM') {
                        companies.push({
                            setor,
                            subsetor,
                            segmento,
                            empresa: value.trim(),
                            codigo: worksheet['D' + row].v,
                            listSeg: worksheet['E' + row] ? worksheet['E' + row].v.trim() : '',
                        })
                    }
                }
            }
        })
        return companies
    }
    const { data: cmvPage } = await axios.request({
        method: 'GET',
        url: Urls.ClassificacaoSetorial,
        responseType: 'text',
    })
    if (!cmvPage) return []
    const tmpDownload = downloadDir ? downloadDir : tmpDir
    const fileUrlRegex = new RegExp(/href=\"(.+)?\">Download/g)
    const match = fileUrlRegex.exec(cmvPage)
    if (!match || match.length < 2) return []
    const zipUrl = match[1]
    const zipOutput = path.resolve(tmpDownload, 'setor.zip')
    await downloadFile(zipUrl, path.resolve(tmpDownload, 'setor.zip'))
    const [unzippedFile] = await unzip(zipOutput, tmpDownload)
    const companies = parseSectorXlsx(unzippedFile)
    return companies
}
export const getIndexComposition = async (index: B3Index): Promise<IIBOVComposicao> => {
    try {
        const valid = [
            'IFNC',
            'BDRX',
            'ICON',
            'IEEX',
            'IFIX',
            'IMAT',
            'IDIV',
            'INDX',
            'IMOB',
            'MLCX',
            'SMLL',
            'SMLL',
            'UTIL',
            'IVBX',
        ]

        if (valid.indexOf(index) === -1) {
            throw new Error(`${index} not valid! Valids are: ${valid.join(', ')}`)
        }
        const reqData = JSON.stringify({
            index,
            language: 'pt-br',
        })

        const token = Buffer.from(reqData).toString('base64')
        const headers = {
            Host: 'sistemaswebb3-listados.b3.com.br',
            Connection: 'keep-alive',
            Pragma: 'no-cache',
            'Cache-Control': 'no-cache',
            'sec-ch-ua': '"Chromium";v="92", " Not A;Brand";v="99", "Google Chrome";v="92"',
            Accept: 'application/json, text/plain, */*',
            'sec-ch-ua-mobile': '?0',
            'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
            'x-dtpc': '24$585938861_484h25vTFLPVTPIHSVNPFRSGANQNCMHRHSWMMPT-0e14',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
            Referer: 'https://sistemaswebb3-listados.b3.com.br/',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,zh-TW;q=0.6,zh;q=0.5',
            Cookie: 'rxVisitor=1628984299644B8TRKURS3J2LER8C40ITPD3JMSQSFDU1; _sp_ses.8319=*; _sp_first_session.8319=http%3A%2F%2Fbvmf.bmfbovespa.com.br%2F; _ga=GA1.3.162196213.1628984301; _gid=GA1.3.2128791217.1628984301; _hjid=5a160d14-7bf5-40f0-8b53-42111d37de65; _hjAbsoluteSessionInProgress=1; rdtrk=%7B%22id%22%3A%22fbbc9c3b-4db2-4194-9105-b496b78b931d%22%7D; OptanonAlertBoxClosed=2021-08-14T23:56:15.260Z; TS0171d45d=011d592ce1ad2630aad8ccfdf9a8a1df4efed490ff117a77ed5d9c11c9cc97e9544b455321523f794d689f8b6859f94629fcb0447db1c4b3a5f96893c6a52aa859c58882afba10554140059802f3e5d30f99b04f6a7ef2635833d5a6232508dc5b3852eeb98013f0326f2b3a41e1a3ae2f975bf67c7ed082c3759cbb00c11d536f6d3d2cf3617adca8ee019196acb17ba6a75f1f3ec06ba34cd7159a2a8ca29a864360f7e8cee7fd360d8c6f8984d93784778b6ec09d2aa9f22fbe6659c2b2abb5d993b742; dtSa=-; _sp_id.8319=3260b39c-8e69-5ed4-ac29-c923ec159db1.1628984300.1.1628985870.1628984300.b9373c2f-2de7-5745-8bb8-003122e5dbb2; __trf.src=encoded_eyJmaXJzdF9zZXNzaW9uIjp7InZhbHVlIjoiaHR0cDovL2J2bWYuYm1mYm92ZXNwYS5jb20uYnIvIiwiZXh0cmFfcGFyYW1zIjp7fX0sImN1cnJlbnRfc2Vzc2lvbiI6eyJ2YWx1ZSI6Iihub25lKSIsImV4dHJhX3BhcmFtcyI6e319LCJjcmVhdGVkX2F0IjoxNjI4OTg1ODcwMDg2fQ==; OptanonConsent=isGpcEnabled=0&datestamp=Sat+Aug+14+2021+21%3A04%3A31+GMT-0300+(Brasilia+Standard+Time)&version=6.21.0&isIABGlobal=false&hosts=&landingPath=NotLandingPage&groups=C0003%3A1%2CC0001%3A1%2CC0004%3A1%2CC0002%3A1&AwaitingReconsent=false&geolocation=%3B; dtCookie=v_4_srv_24_sn_68417A50092052C7FBA7A4016B901240_perc_100000_ol_0_mul_1_app-3Afd69ce40c52bd20e_1_app-3A8f97c75ad513b79e_1_rcs-3Acss_0; TS01871345=011d592ce14d48c4ec0ebf809ba44b80912f2aa1991dca56960489d0fa92d08807238733bcbfd32b9fc57a92cf84e8889a345759e6; TS0134a800=011d592ce14d48c4ec0ebf809ba44b80912f2aa1991dca56960489d0fa92d08807238733bcbfd32b9fc57a92cf84e8889a345759e6; BIGipServerpool_sistemaswebb3-listados_8443_WAF=1329140746.64288.0000; _gat_gtag_UA_94042116_5=1; dtLatC=2; rxvt=1628987783615|1628984299646; dtPC=24$585938861_484h25vTFLPVTPIHSVNPFRSGANQNCMHRHSWMMPT-0e14',
        }
        // At request level
        const agent = new https.Agent({
            rejectUnauthorized: false,
        })
        const url = `https://sistemaswebb3-listados.b3.com.br/indexProxy/indexCall/GetDownloadPortfolioDay/${token}`

        const { data } = await axios.get(url, { headers, httpsAgent: agent })
        const csv = Buffer.from(data, 'base64').toString()
        if (!csv) throw new Error(`Could not get the data`)
        const companies = csv
            .split('\r\n')
            .map((line) => {
                const [ticker, company, type, theorQty, sharePct] = line.split(';')
                if (!company || !sharePct) return null
                return {
                    ticker: ticker.trim(),
                    company: company.trim(),
                    type: type.replace(/ +/g, ' ').trim(),
                    theorQty: Number(theorQty.replace(/\./g, '')),
                    sharePct: Number(sharePct.replace(/,/g, '.')),
                }
            })
            .filter((e) => e && e.sharePct)
        const redutor = csv
            ?.split('\r\n')
            ?.slice(-2)
            ?.find((e) => e.indexOf('Redutor') >= 0)
            ?.split(';')
            ?.slice(-1)[0]
            ?.trim()
            ?.replace(/\./g, '')
            ?.replace(',', '.')

        const qtdTeorica = csv
            ?.split('\r\n')
            ?.find((e) => e.indexOf('Quantidade') >= 0)
            ?.split(';')[3]
            ?.trim()
            ?.replace(/\./g, '')
            ?.replace(',', '.')

        if (!redutor || !qtdTeorica) throw new Error(`Could not find Redutor or Qtd Teorica`)

        const sumTheorQty = companies.reduce((cum, curr) => cum + (curr?.theorQty || 0), 0)
        const sumSharePct = companies.reduce((cum, curr) => cum + (curr?.sharePct || 0), 0)

        return {
            updateAt: moment().format('DD/MM/YYYY HH:mm:ss'),
            redutor: Number(redutor),
            qtdTeorica: Number(qtdTeorica),
            carteira: companies as ICarteira[],
            isValid: sumTheorQty === Number(qtdTeorica) && sumSharePct >= 99.999,
        }
    } catch (error) {
        throw error
    }
}
