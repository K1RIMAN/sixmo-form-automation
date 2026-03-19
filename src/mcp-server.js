#!/usr/bin/env node

/**
 * MCP (Model Context Protocol) Tool Server for the sixmo.ru form automation.
 *
 * This server exposes the form automation as a callable tool that any
 * MCP-compatible agent (Claude Code, etc.) can invoke.
 *
 * Protocol: JSON-RPC 2.0 over stdio
 *
 * Tool: "fill_sixmo_form"
 *   - Accepts form field data and an optional file path
 *   - Runs headless Playwright automation against https://sixmo.ru/
 *   - Returns the result page content
 */

const { automateForm } = require("./automate-form");
const readline = require("readline");
const path = require("path");
const fs = require("fs");

const TOOL_NAME = "fill_sixmo_form";

const TOOL_DEFINITION = {
  name: TOOL_NAME,
  description:
    "Automates filling and submitting the multi-step web form at https://sixmo.ru/ (Adaptive Flow Challenge). " +
    "Handles dynamic fields, file upload, anti-bot telemetry, and field reordering. " +
    "Returns the final result page content.",
  inputSchema: {
    type: "object",
    properties: {
      form_data: {
        type: "object",
        description:
          "Key-value pairs for form fields. Keys are field names (dynamic, determined at runtime). " +
          "If a field name from the form is not found in this object, a sensible default is used. " +
          'Example: {"first_name": "Иван", "email": "test@mail.com", "city": "Москва"}',
        additionalProperties: { type: "string" },
      },
      file_path: {
        type: "string",
        description:
          "Absolute path to a file to upload on the file-upload step. " +
          "Accepted formats: .txt, .md, .json. If omitted, a default test file is created and uploaded.",
      },
      headless: {
        type: "boolean",
        description: "Run browser in headless mode (default: true).",
        default: true,
      },
    },
    required: [],
  },
};

// --- JSON-RPC helpers ---

function makeResponse(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function makeError(id, code, message, data) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined && { data }) },
  });
}

// --- Request handlers ---

async function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case "initialize":
      return makeResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "sixmo-form-automation",
          version: "1.0.0",
        },
      });

    case "notifications/initialized":
      // No response needed for notifications
      return null;

    case "tools/list":
      return makeResponse(id, { tools: [TOOL_DEFINITION] });

    case "tools/call": {
      const toolName = params?.name;
      if (toolName !== TOOL_NAME) {
        return makeError(id, -32602, `Unknown tool: ${toolName}`);
      }

      const args = params?.arguments || {};
      try {
        console.error(`[MCP] Running ${TOOL_NAME}...`);
        const result = await automateForm({
          formData: args.form_data || {},
          filePath: args.file_path || null,
          headless: args.headless !== false,
          timeout: 90000,
        });

        return makeResponse(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        });
      } catch (error) {
        return makeResponse(id, {
          content: [
            {
              type: "text",
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        });
      }
    }

    default:
      return makeError(id, -32601, `Method not found: ${method}`);
  }
}

// --- stdio transport ---

function startServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  let buffer = "";

  process.stdin.on("data", async (chunk) => {
    buffer += chunk.toString();

    // Process complete lines
    const lines = buffer.split("\n");
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        const response = await handleRequest(msg);
        if (response) {
          process.stdout.write(response + "\n");
        }
      } catch (e) {
        console.error(`[MCP] Parse error: ${e.message}`);
        const errResp = makeError(null, -32700, "Parse error");
        process.stdout.write(errResp + "\n");
      }
    }
  });

  process.stdin.on("end", () => {
    process.exit(0);
  });

  console.error("[MCP] sixmo-form-automation server started (stdio)");
}

startServer();
