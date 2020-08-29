const _ = require("lodash")
const async = require("async")
const axios = require("axios")
const jsonfile = require("jsonfile")
const millify = require("millify")
const rax = require("retry-axios")

const downloadMonth = "https://api.npmjs.org/downloads/point/last-month/"
const downloadTotal =
  "https://api.npmjs.org/downloads/range/2020-01-01:3000-01-01/"

// Retry axios functionality
const interceptorId = rax.attach()

let lastMonthDownloads = []
let totalDownloads = []

// Fetch NPM stats
const statsGet = async package => {
  try {
    const response = await axios.get(downloadMonth + package)
    lastMonthDownloads.push(response.data.downloads)
  } catch (error) {
    console.error(error)
  }
  try {
    const response = await axios.get(downloadTotal + package)
    const downloadArray = response.data.downloads.map(item => item.downloads)
    totalDownloads.push(_.sum(downloadArray))
  } catch (error) {
    console.error(error)
  }
  console.log(`Fetched ${package}`)
}

// Get fontlist keys only
const fontList = Object.keys(jsonfile.readFileSync("./data/fontlist.json"))

// EventEmitter is usually limited to 10. Remove restriction for more concurrency.
require("events").EventEmitter.defaultMaxListeners = 0
const queue = async.queue(statsGet, 18)

queue.error((err, package) => {
  console.error(`${package} experienced an error.`, err)
})

queue.drain(() => {
  const downloadsMonthBadge = millify.default(_.sum(lastMonthDownloads), {
    precision: 2,
  })
  const badgeMonth = {
    schemaVersion: 1,
    label: "downloads",
    message: `${downloadsMonthBadge}/month`,
    color: "brightgreen",
  }
  jsonfile.writeFileSync("./data/badgeMonth.json", badgeMonth)

  const downloadsTotalBadge = millify.default(_.sum(totalDownloads), {
    precision: 2,
  })
  const badgeTotal = {
    schemaVersion: 1,
    label: "downloads",
    message: downloadsTotalBadge,
    color: "brightgreen",
  }
  jsonfile.writeFileSync("./data/badgeTotal.json", badgeTotal)
})

const production = () => {
  _.forEach(fontList, font => {
    queue.push(`fontsource-${font}`)
  })
}

production()
