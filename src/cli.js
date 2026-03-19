#!/usr/bin/env node

/**
 * CLI wrapper for the form automation.
 *
 * Usage:
 *   node src/cli.js [--file <path>] [--headless] [--visible] [--field key=value ...]
 *
 * Examples:
 *   node src/cli.js --file ./resume.txt --field first_name=Иван --field email=test@test.com
 *   node src/cli.js --visible --file ./data.json
 */

const { automateForm } = require("./automate-form");
const path = require("path");

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { formData: {}, filePath: null, headless: true, timeout: 60000 };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--file":
      case "-f":
        result.filePath = path.resolve(args[++i]);
        break;
      case "--visible":
      case "--headed":
        result.headless = false;
        break;
      case "--headless":
        result.headless = true;
        break;
      case "--timeout":
      case "-t":
        result.timeout = parseInt(args[++i], 10);
        break;
      case "--field":
        const [key, ...valueParts] = args[++i].split("=");
        result.formData[key] = valueParts.join("=");
        break;
      case "--data":
      case "-d":
        // JSON string of form data
        Object.assign(result.formData, JSON.parse(args[++i]));
        break;
      default:
        if (args[i].includes("=") && !args[i].startsWith("-")) {
          const [k, ...v] = args[i].split("=");
          result.formData[k] = v.join("=");
        }
        break;
    }
  }

  return result;
}

async function main() {
  const params = parseArgs(process.argv);
  console.log("Starting form automation with params:", {
    filePath: params.filePath,
    headless: params.headless,
    fieldCount: Object.keys(params.formData).length,
  });

  try {
    const result = await automateForm(params);
    console.log("\n=== AUTOMATION COMPLETE ===");
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("\n=== AUTOMATION FAILED ===");
    console.error(error.message);
    process.exit(1);
  }
}

main();
