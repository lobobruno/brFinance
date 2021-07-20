import puppeteer from 'puppeteer'
class MyBrowser {
    wsChromeEndpointUrl: string
    browser: puppeteer.Browser | null
    page: puppeteer.Page | null
    puppeteerHeadless = false //false = mostra browser
    userAgent: string
    constructor(wsChromeEndpointUrl = '') {
        this.wsChromeEndpointUrl = wsChromeEndpointUrl
        this.browser = null
        this.page = null
        this.puppeteerHeadless = false //false = mostra browser
        this.userAgent =
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36'
    }
    async getBrowser(): Promise<puppeteer.Browser> {
        if (!this.browser) {
            if (this.wsChromeEndpointUrl) {
                try {
                    this.browser = await puppeteer.connect({
                        browserWSEndpoint: this.wsChromeEndpointUrl,
                    })
                } catch (error) {
                    console.log('NÃO FOI POSSÍVEL ENTRAR NO MODO DEBUG.\nVERIFIQUE O wsChromeEndpointUrl')
                    this.browser = await puppeteer.launch({
                        headless: this.puppeteerHeadless,
                    })
                }
            } else {
                this.browser = await puppeteer.launch({
                    headless: this.puppeteerHeadless,
                })
            }
        }
        return this.browser
    }
    async getPage() {
        if (!this.page) {
            const browser = await this.getBrowser()
            const page = await browser.newPage()
            await page.setViewport({ width: 1280, height: 800 })
            await page.setUserAgent(this.userAgent)

            this.page = page
        }
        return this.page
    }
    async goTo(url: string): Promise<puppeteer.Page> {
        const page = await this.getPage()
        await page.goto(url, { waitUntil: 'networkidle2' })
        return page
    }
}

const browser = new MyBrowser('ws://127.0.0.1:9222/devtools/browser/ecc49060-8e0c-4cbc-a5da-bbf246608e56')
export { browser }
