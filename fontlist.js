const axios = require("axios")
const jsonfile = require("jsonfile")
const rax = require("retry-axios")

const fontListURL =
  "https://raw.githubusercontent.com/fontsource/fontsource/master/FONTLIST.json"

axios
  .get(fontListURL)
  .then(function (response) {
    jsonfile.writeFileSync("./data/fontlist.json", response.data)
    console.log("Successfully fetched Fontsource fontlist.")
  })
  .catch(function (error) {
    console.log(error)
  })
