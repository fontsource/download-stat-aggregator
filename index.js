const _ = require("lodash")
const async = require("async")
const axios = require("axios")
const jsonfile = require("jsonfile")
const millify = require("millify").default
const rax = require("retry-axios")

const downloadMonth = "https://api.npmjs.org/downloads/point/last-month/"
const downloadTotal =
  "https://api.npmjs.org/downloads/range/2020-01-01:3000-01-01/"

const lastMonthDownloads = []
const totalDownloads = []

const lastMonthPopular = {}
const totalPopular = {}

rax.attach()

// Fetch NPM stats
const statsGet = async package => {
  try {
    const response = await axios({
      method: "get",
      url: downloadMonth + package,
      raxConfig: {
        retryDelay: 10000,
        httpMethodsToRetry: ["GET"],
        statusCodesToRetry: [[429, 429]],
        backoffType: "static",
      },
    })
    lastMonthDownloads.push(response.data.downloads)
    lastMonthPopular[package] = response.data.downloads
  } catch (error) {
    console.error(error)
  }
  try {
    const response = await axios({
      method: "get",
      url: downloadTotal + package,
      raxConfig: {
        retryDelay: 10000,
        httpMethodsToRetry: ["GET"],
        statusCodesToRetry: [[429, 429]],
        backoffType: "static",
      },
    })
    const downloadArray = response.data.downloads.map(item => item.downloads)
    const downloads = _.sum(downloadArray)
    totalDownloads.push(downloads)
    totalPopular[package] = downloads
  } catch (error) {
    console.error(error)
  }
  console.log(`Fetched ${package}`)
}

// EventEmitter is usually limited to 10. Remove restriction for more concurrency.
require("events").EventEmitter.defaultMaxListeners = 0
const queue = async.queue(statsGet, 1)

queue.error((err, package) => {
  console.error(`${package} experienced an error.`, err)
})

queue.drain(() => {
  const downloadsMonth = _.sum(lastMonthDownloads)
  const downloadsTotal = _.sum(totalDownloads)

  const existingDownloadsTotal = _.sum(
    Object.values(jsonfile.readFileSync("./data/totalPopular.json"))
  )

  if (downloadsTotal > existingDownloadsTotal) {
    const downloadsMonthBadge = millify(downloadsMonth, {
      precision: 2,
    })
    const downloadsTotalBadge = millify(downloadsTotal, {
      precision: 2,
    })

    console.log(`Month: ${downloadsMonthBadge}`)
    console.log(`Year: ${downloadsTotalBadge}`)

    const badgeMonth = {
      schemaVersion: 1,
      label: "downloads",
      message: `${downloadsMonthBadge}/month`,
      color: "brightgreen",
    }
    jsonfile.writeFileSync("./data/badgeMonth.json", badgeMonth)

    const badgeTotal = {
      schemaVersion: 1,
      label: "downloads",
      message: downloadsTotalBadge,
      color: "brightgreen",
    }
    jsonfile.writeFileSync("./data/badgeTotal.json", badgeTotal)

    // Reconstructs array back into object.
    const sortedLastMonthPopular = Object.fromEntries(
      // Flips from ascending order to descending. Deconstructs object to array for sort.
      _.reverse(Object.entries(lastMonthPopular).sort(([, a], [, b]) => a - b))
    )
    const sortedTotalPopular = Object.fromEntries(
      _.reverse(Object.entries(totalPopular).sort(([, a], [, b]) => a - b))
    )

    jsonfile.writeFileSync(
      "./data/lastMonthPopular.json",
      sortedLastMonthPopular
    )
    jsonfile.writeFileSync("./data/totalPopular.json", sortedTotalPopular)
  }
})

// Get fontlist
const fontList = jsonfile.readFileSync("./data/fontlist.json")
const legacyFontlist = jsonfile.readFileSync("./data/legacy-fontlist.json")

const production = () => {
  for (const [key, isVariable] of Object.entries(fontList)) {
    queue.push(`@fontsource/${key}`)
    if (isVariable) {
      queue.push(`@fontsource-variable/${key}`)
    }
  }

  for (const id of Object.keys(legacyFontlist)) {
    queue.push(`fontsource/${id}`)
  }
}

production()
