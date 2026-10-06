import api from "./client";

export function listRacks() {
  return api.get("/racks").then((r) => r.data);
}

export function createRack(data) {
  return api.post("/racks", data).then((r) => r.data);
}

export function updateRack(letter, data) {
  return api.patch(`/racks/${letter}`, data).then((r) => r.data);
}

export function deleteRack(letter) {
  return api.delete(`/racks/${letter}`).then((r) => r.data);
}
