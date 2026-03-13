const path = require("path");
const fs = require("fs");
const { app } = require("electron");

class EnvironmentManager {
  constructor() {
    this.loadEnvironmentVariables();
  }

  loadEnvironmentVariables() {
    // In production, try multiple locations for .env file
    const possibleEnvPaths = [
      // Development path
      path.join(__dirname, "..", ".env"),
      // Production packaged app paths
      path.join(process.resourcesPath, ".env"),
      path.join(process.resourcesPath, "app.asar.unpacked", ".env"),
      path.join(app.getPath("userData"), ".env"), // User data directory
      // Legacy paths
      path.join(process.resourcesPath, "app", ".env"),
    ];

    for (const envPath of possibleEnvPaths) {
      try {
        if (fs.existsSync(envPath)) {
          const result = require("dotenv").config({ path: envPath });
          if (!result.error) {
            break;
          }
        }
      } catch (error) {
        // Continue to next path
      }
    }
  }

  _getKey(envVarName) {
    return process.env[envVarName] || "";
  }

  _saveKey(envVarName, key) {
    process.env[envVarName] = key;
    return { success: true };
  }

  getOpenAIKey() {
    return this._getKey("OPENAI_API_KEY");
  }

  saveOpenAIKey(key) {
    return this._saveKey("OPENAI_API_KEY", key);
  }

  getAnthropicKey() {
    return this._getKey("ANTHROPIC_API_KEY");
  }

  saveAnthropicKey(key) {
    return this._saveKey("ANTHROPIC_API_KEY", key);
  }

  getGeminiKey() {
    return this._getKey("GEMINI_API_KEY");
  }

  saveGeminiKey(key) {
    return this._saveKey("GEMINI_API_KEY", key);
  }

  getGroqKey() {
    return this._getKey("GROQ_API_KEY");
  }

  saveGroqKey(key) {
    return this._saveKey("GROQ_API_KEY", key);
  }

  getZaiKey() {
    return this._getKey("ZAI_API_KEY");
  }

  saveZaiKey(key) {
    return this._saveKey("ZAI_API_KEY", key);
  }

  getVolcengineAppId() {
    return this._getKey("VOLCENGINE_APP_ID");
  }

  saveVolcengineAppId(value) {
    return this._saveKey("VOLCENGINE_APP_ID", value);
  }

  getVolcengineAccessToken() {
    return this._getKey("VOLCENGINE_ACCESS_TOKEN");
  }

  saveVolcengineAccessToken(value) {
    return this._saveKey("VOLCENGINE_ACCESS_TOKEN", value);
  }

  getVolcengineResourceId() {
    return this._getKey("VOLCENGINE_RESOURCE_ID");
  }

  saveVolcengineResourceId(value) {
    return this._saveKey("VOLCENGINE_RESOURCE_ID", value);
  }

  createProductionEnvFile(apiKey) {
    const envPath = path.join(app.getPath("userData"), ".env");

    const envContent = `# OpenWhispr Environment Variables
# This file was created automatically for production use
OPENAI_API_KEY=${apiKey}
`;

    fs.writeFileSync(envPath, envContent, "utf8");

    require("dotenv").config({ path: envPath });

    return { success: true, path: envPath };
  }

  saveAllKeysToEnvFile() {
    const envPath = path.join(app.getPath("userData"), ".env");

    // Build env content with all current keys
    let envContent = `# OpenWhispr Environment Variables
# This file was created automatically for production use
`;

    if (process.env.OPENAI_API_KEY) {
      envContent += `OPENAI_API_KEY=${process.env.OPENAI_API_KEY}\n`;
    }
    if (process.env.ANTHROPIC_API_KEY) {
      envContent += `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}\n`;
    }
    if (process.env.GEMINI_API_KEY) {
      envContent += `GEMINI_API_KEY=${process.env.GEMINI_API_KEY}\n`;
    }
    if (process.env.GROQ_API_KEY) {
      envContent += `GROQ_API_KEY=${process.env.GROQ_API_KEY}\n`;
    }
    if (process.env.ZAI_API_KEY) {
      envContent += `ZAI_API_KEY=${process.env.ZAI_API_KEY}\n`;
    }
    if (process.env.VOLCENGINE_APP_ID) {
      envContent += `VOLCENGINE_APP_ID=${process.env.VOLCENGINE_APP_ID}\n`;
    }
    if (process.env.VOLCENGINE_ACCESS_TOKEN) {
      envContent += `VOLCENGINE_ACCESS_TOKEN=${process.env.VOLCENGINE_ACCESS_TOKEN}\n`;
    }
    if (process.env.VOLCENGINE_RESOURCE_ID) {
      envContent += `VOLCENGINE_RESOURCE_ID=${process.env.VOLCENGINE_RESOURCE_ID}\n`;
    }

    fs.writeFileSync(envPath, envContent, "utf8");

    // Reload the env file
    require("dotenv").config({ path: envPath });

    return { success: true, path: envPath };
  }
}

module.exports = EnvironmentManager;
