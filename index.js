const _ = require("lodash")
const async = require("async")
const axios = require("axios")
const jsonfile = require("jsonfile")
const millify = require("millify").default
const rax = require("retry-axios")

const existingTotalDownload = require("./data/badgeTotal.json")

const downloadMonth = "https://api.npmjs.org/downloads/point/last-month/"
const downloadTotal =
  "https://api.npmjs.org/downloads/range/2020-01-01:3000-01-01/"

const lastMonthDownloads = []
const totalDownloads = []

const lastMonthPopular = {}
const totalPopular = {}

const interceptorId = rax.attach()

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

// Get fontlist keys only
const fontList = Object.keys(jsonfile.readFileSync("./data/fontlist.json"))

// EventEmitter is usually limited to 10. Remove restriction for more concurrency.
require("events").EventEmitter.defaultMaxListeners = 0
const queue = async.queue(statsGet, 12)

queue.error((err, package) => {
  console.error(`${package} experienced an error.`, err)
})

queue.drain(() => {
  const downloadsMonthBadge = millify(_.sum(lastMonthDownloads), {
    precision: 2,
  })
  const downloadsTotalBadge = millify(_.sum(totalDownloads), {
    precision: 2,
  })

  // NPM downloads can be volatile and sometimes might error out a lot in a workflow.
  // Hence we sometimes fluctuate in the millions.
  if (
    downloadsTotalBadge.replace(/\D/g, "") >
    existingTotalDownload.message.replace(/\D/g, "")
  ) {
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

const production = () => {
  _.forEach(fontList, font => {
    queue.push(`fontsource-${font}`)
    queue.push(`@fontsource/${font}`)
  })
}

production()
