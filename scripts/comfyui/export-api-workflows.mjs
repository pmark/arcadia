#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const sourceDir = path.join(repoRoot, "config/intelligence/comfyui");
const outputDir = process.env.ARCADIA_COMFYUI_WORKFLOW_DIR?.trim() || "/Users/pmark/AI/Arcadia-ComfyUI/workflows";

const workflows = [
  ["flux2-klein-text-to-image.json", "arcadia-image-generate.json", "generate"],
  ["flux2-klein-image-edit-4b-distilled.json", "arcadia-image-edit.json", "edit"],
  ["flux2-klein-image-edit-4b-base.json", "arcadia-image-edit-base.json", "edit"],
];

await mkdir(outputDir, { recursive: true });
for (const [sourceName, outputName, kind] of workflows) {
  const graph = JSON.parse(await readFile(path.join(sourceDir, sourceName), "utf8"));
  const api = expandWorkflow(graph, kind);
  await writeFile(path.join(outputDir, outputName), `${JSON.stringify(api, null, 2)}\n`);
  console.log(`wrote ${path.join(outputDir, outputName)}`);
}

function expandWorkflow(graph, kind) {
  const subgraphNode = graph.nodes.find((node) => graph.definitions?.subgraphs?.some((subgraph) => subgraph.id === node.type));
  if (!subgraphNode) throw new Error("Workflow does not contain a subgraph node.");
  const subgraph = graph.definitions.subgraphs.find((candidate) => candidate.id === subgraphNode.type);
  const links = new Map(subgraph.links.map((link) => [link.id, link]));
  const externalValues = externalInputs(graph, subgraphNode, subgraph, kind);
  const prompt = {};

  for (const node of subgraph.nodes) {
    if (node.id < 0) continue;
    prompt[String(node.id)] = { class_type: node.type, inputs: nodeInputs(node, links, externalValues, kind) };
  }

  if (kind === "edit") {
    prompt["8000"] = {
      class_type: "LoadImage",
      inputs: { image: "arcadia-input.png", upload: "image" },
    };
    const imageScaleNode = subgraph.nodes.find((node) => node.type === "ImageScaleToTotalPixels");
    if (!imageScaleNode) throw new Error("Edit workflow does not contain ImageScaleToTotalPixels.");
    prompt[String(imageScaleNode.id)].inputs.image = ["8000", 0];
  }

  prompt["9000"] = {
    class_type: "SaveImage",
    inputs: { images: ["65", 0], filename_prefix: "Arcadia" },
  };

  return prompt;
}

function externalInputs(graph, subgraphNode, subgraph, kind) {
  const outerLinks = new Map((graph.links ?? []).map((link) => [link[0], link]));
  const values = new Map();
  const widgets = subgraphNode.widgets_values ?? [];
  const widgetByName = new Map([
    ["text", widgets[0]],
    ["value", widgets[1] ?? 1024],
    ["value_1", widgets[2] ?? 1024],
    ["unet_name", kind === "generate" ? "flux-2-klein-4b.safetensors" : normalizeModelName(widgets[3] ?? "flux-2-klein-4b.safetensors")],
    ["clip_name", widgets[4] ?? "qwen_3_4b.safetensors"],
    ["vae_name", widgets[5] ?? "flux2-vae.safetensors"],
  ]);

  for (const [slot, input] of subgraph.inputs.entries()) {
    const outerInput = subgraphNode.inputs?.find((candidate) => candidate.name === input.name);
    const outerLink = outerInput?.link ? outerLinks.get(outerInput.link) : undefined;
    values.set(slot, outerLink ? [String(outerLink[1]), outerLink[2]] : widgetByName.get(input.name));
  }
  return values;
}

function normalizeModelName(name) {
  return name.replace(/-fp8\.safetensors$/, ".safetensors");
}

function nodeInputs(node, links, externalValues, kind) {
  const inputs = {};
  const linkFor = (linkId) => {
    const link = links.get(linkId);
    if (!link) throw new Error(`Missing subgraph link ${linkId} for node ${node.id}.`);
    if (link.origin_id === -10) return externalValues.get(link.origin_slot);
    return [String(link.origin_id), link.origin_slot];
  };

  for (const input of node.inputs ?? []) {
    if (input.link !== undefined && input.link !== null) {
      inputs[input.name] = linkFor(input.link);
    }
  }

  const widgets = node.widgets_values ?? [];
  switch (node.type) {
    case "KSamplerSelect":
      inputs.sampler_name = widgets[0] ?? "euler";
      break;
    case "UNETLoader":
      inputs.weight_dtype = widgets[1] ?? "default";
      break;
    case "CLIPLoader":
      inputs.type = widgets[1] ?? "flux2";
      break;
    case "EmptyFlux2LatentImage":
      inputs.batch_size = widgets[2] ?? 1;
      break;
    case "Flux2Scheduler":
      inputs.steps = kind === "generate" ? 4 : widgets[0] ?? 4;
      break;
    case "ImageScaleToTotalPixels":
      inputs.upscale_method = widgets[0] ?? "nearest-exact";
      inputs.scale_by = widgets[1] ?? 1;
      break;
    case "RandomNoise":
      inputs.noise_seed = widgets[0] ?? 0;
      break;
    case "CFGGuider":
      inputs.cfg = kind === "generate" ? 1 : widgets[0] ?? 1;
      break;
    case "PrimitiveInt":
      inputs.value = inputs.value ?? widgets[0] ?? 1024;
      break;
    case "CLIPTextEncode":
      inputs.text = inputs.text ?? widgets[0] ?? "";
      break;
  }
  return inputs;
}
