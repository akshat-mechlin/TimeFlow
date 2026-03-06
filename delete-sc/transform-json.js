// transform-json.js
import fs from 'fs'

// 1️⃣ Read your ugly JSON file
const rawData = fs.readFileSync('files.json', 'utf-8') // your JSON file
const jsonData = JSON.parse(rawData)

// 2️⃣ Extract the "name" property from each object
const filesToDelete = jsonData.map(item => item.name)

// 3️⃣ Convert to JS array string
const jsArrayString = `const filesToDelete = [\n  "${filesToDelete.join('",\n  "')}"\n]`

// 4️⃣ Save to a new JS file or print
fs.writeFileSync('filesToDelete.js', jsArrayString)
console.log("Converted to JS array: filesToDelete.js")