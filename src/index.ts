import * as core from "@actions/core";
import { setTimeout } from "timers/promises";
import fetch from "node-fetch";
const requiredInputOption = {
  required: true,
  trimWhiteSpace: true,
};
const notRequiredInputOption = {
  required: false,
  trimWhiteSpace: true,
};

interface RequiredInputs {
  accessToken: string;
  bucketName: string;
  glossaryName: string;
  glossaryFileName: string;
  projectId: string;
}

export interface ErrorResponse {
  error: ErrorMessage;
}

export interface ErrorMessage {
  code: number;
  message: string;
  status?: string;
}

export interface GoogleResponse {
  name?: string;
  metadata?: MetaData;
  error?: ErrorMessage;
  done?: string;
}

export interface MetaData {
  "@type": string;
  name: string;
  state: STATE;
}

export type STATE = "FAILED" | "RUNNING" | "SUCCEEDED";

export async function createGlossary(
  input: string,
  projectId: string,
  accessToken: string
) {
  const endPoint = `https://translation.googleapis.com/v3/projects/${projectId}/locations/us-central1/glossaries`;
  let resp = await fetch(endPoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: input,
  });
  if (resp.status >= 300) {
    let message = await resp.text();
    core.debug(`error message:${message}`);
    core.error(
      `delete glossary request failed with status:${resp.status} message:${message}`
    );
    throw Error("delete request failed");
  }
  const message = (await resp.json()) as GoogleResponse;
  return message.name;
}

export async function deleteGlossary(
  projectId: string,
  glossaryName: string,
  accessToken: string
) {
  const endPoint = `https://translation.googleapis.com/v3/projects/${projectId}/locations/us-central1/glossaries/${glossaryName}`;
  let resp = await fetch(endPoint, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (resp.status === 404) {
    core.debug(`response message: ${await resp.text()}`);
    core.warning(`glossary ${glossaryName} is not found,continue to create`);
    return;
  }
  if (resp.status >= 300) {
    let message = await resp.text();
    core.debug(`error message:${message}`);
    core.error(
      `delete glossary request failed with status:${
        resp.status
      } message:${JSON.stringify(message)}`
    );
    throw Error("delete request failed");
  }
  core.debug(`response message :${await resp.text()}`);
  return;
}

export async function headOperation(name: string, accessToken: string) {
  const endPoint = `https://translation.googleapis.com/v3/${name}`;
  let resp = await fetch(endPoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (resp.status >= 300) {
    let message = (await resp.json()) as GoogleResponse;
    core.debug(`error message:${message}`);
    core.error(
      `delete glossary request failed with status:${
        resp.status
      } message:${JSON.stringify(message)}`
    );
    throw Error("delete request failed");
  }
  const message = (await resp.json()) as GoogleResponse;
  return message;
}

function getRequiredInputs(): RequiredInputs {
  const accessToken = core.getInput("access-token");
  const bucketName = core.getInput("bucket-name", requiredInputOption);
  const glossaryName = core.getInput("glossary-name", requiredInputOption);
  const glossaryFileName = core.getInput(
    "glossary-file-name",
    requiredInputOption
  );
  const projectId = core.getInput("project-id", requiredInputOption);
  return {
    bucketName,
    glossaryFileName,
    glossaryName,
    projectId,
    accessToken,
  };
}

type CreateType = "onePair" | "codesSet";
export async function handler(...inputsRaw: string[]) {
  if (inputsRaw.length > 2) {
    throw Error("input can not be more than 2 string object");
  }
  let type: CreateType = inputsRaw.length > 1 ? "onePair" : "codesSet";
  const { bucketName, glossaryFileName, projectId, glossaryName, accessToken } =
    getRequiredInputs();
  core.info(`try delete existed resource: ${projectId}/${glossaryName}`);
  // try delete glossary existed resource first.
  await deleteGlossary(projectId, glossaryName, accessToken);
  const glossaryFullName = `projects/${projectId}/locations/us-central1/glossaries/${glossaryName}`;
  const glossaryFilePath = `gs://${bucketName}/${glossaryFileName}`;
  let input;
  switch (type) {
    case "onePair":
      input = JSON.stringify({
        name: glossaryFullName,
        languagePair: {
          sourceLanguageCode: inputsRaw[0],
          targetLanguageCode: inputsRaw[1],
        },
        inputConfig: {
          gcsSource: {
            inputUri: glossaryFilePath,
          },
        },
      });
      break;
    case "codesSet":
      const codes = inputsRaw[0].split(",");
      input = JSON.stringify({
        name: glossaryFullName,
        languageCodesSet: {
          languageCodes: codes,
        },
        inputConfig: {
          gcsSource: {
            inputUri: glossaryFilePath,
          },
        },
      });
  }
  //  try create glossary resource
  core.info(`try create glossary resource: ${projectId}/${glossaryName}`);
  const name = await createGlossary(input, projectId, accessToken);
  if (!name) {
    core.error("failed to parse google response of name field");
    throw Error("failed to parse google response of name field");
  }
  const waitTimeRaw = parseInt(
    core.getInput("wait-time", notRequiredInputOption)
  );
  let waitTime = isNaN(waitTimeRaw) ? 0 : waitTimeRaw;
  waitTime = waitTime > 300 ? 300 : waitTime;
  if (waitTime !== 0) {
    core.info(`wait for ${waitTime} secs...`);
    await setTimeout(waitTime * 1000);
  }
  core.info(`try head operation: ${name}`);
  const message = await headOperation(name, accessToken);
  if (!message.metadata) {
    core.error("failed to parse google response of metaData field");
    throw Error("failed to parse google response of metaData field");
  }
  if (message.metadata.state === "FAILED") {
    core.error(
      `create operation has failed. message:${message.error?.message}`
    );
    throw Error("create operation failed");
  }
  return message;
}

async function main() {
  const targetLanguage = core.getInput(
    "target-language",
    notRequiredInputOption
  );
  const sourceLanguage = core.getInput(
    "source-language",
    notRequiredInputOption
  );
  const languageCodesSet = core.getInput(
    "language-codes-set",
    notRequiredInputOption
  );
  if (targetLanguage.length !== 0 && sourceLanguage.length !== 0) {
    core.info(
      `detected sourceLanguage: ${sourceLanguage}, targetLanguage ${targetLanguage}`
    );
    core.info(`create one pair glossary resource`);
    const message = await handler(targetLanguage, sourceLanguage);
    if (message.metadata?.state === "RUNNING") {
      core.setOutput("operation-name", message.name);
    }
    core.info(`update is ${message.metadata?.state}`);
    return;
  }
  if (languageCodesSet.length !== 0) {
    core.info(`detected language codes set: ${languageCodesSet}`);
    core.info(`create multi-language glossary resource`);
    const message = await handler(languageCodesSet);
    if (message.metadata?.state === "RUNNING") {
      core.setOutput("operation-name", message.name);
    }
    core.info(`update is ${message.metadata?.state}`);
    return;
  }
  throw Error("Not appropriate language code input setting");
}

try {
  main();
} catch (error: any) {
  core.setFailed(error.message);
}
