#!/usr/bin/env python3
"""Reference checks for Forma design fixtures; not a server or renderer."""
from __future__ import annotations
import copy
import json
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parent
DRAFT_SCHEMA = json.loads((ROOT / "scene-draft.schema.json").read_text())
HOST_SCHEMA = json.loads((ROOT / "host-transaction.schema.json").read_text())
REGISTRY = Registry().with_resources([
    (s["$id"], Resource.from_contents(s)) for s in (DRAFT_SCHEMA, HOST_SCHEMA)
])
DRAFT_VALIDATOR = Draft202012Validator(DRAFT_SCHEMA, registry=REGISTRY)
HOST_VALIDATOR = Draft202012Validator(HOST_SCHEMA, registry=REGISTRY)

class SpecError(ValueError):
    pass

def require(condition, message):
    if not condition:
        raise SpecError(message)

def index_unique(items, key, label):
    result = {}
    for item in items:
        require(item[key] not in result, f"duplicate {label}: {item[key]}")
        result[item[key]] = item
    return result

def check_schema(validator, value):
    errors = list(validator.iter_errors(value))
    if errors:
        raise SpecError("schema: " + errors[0].message)

def check_size(value):
    try:
        payload = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
    except (ValueError, TypeError) as exc:
        raise SpecError("non-JSON or non-finite value") from exc
    require(len(payload) <= 512 * 1024, "payload exceeds 512 KiB")

def validate_draft(draft, resources, previous=None):
    check_size(draft)
    check_schema(DRAFT_VALIDATOR, draft)
    nodes = index_unique(draft["nodes"], "id", "node")
    datasets = index_unique(draft["datasets"], "id", "dataset")
    index_unique(draft["animations"], "id", "animation")
    index_unique(draft["actions"], "id", "action")
    old_nodes = {n["id"]: n for n in previous["nodes"]} if previous else {}

    for node in nodes.values():
        node_id = node["id"]
        if node_id in old_nodes:
            require(node["kind"] == old_nodes[node_id]["kind"], "same key changed node kind")
        parent_id = node["parentId"]
        if parent_id is not None:
            require(parent_id in nodes, "parent missing")
            require(nodes[parent_id]["kind"] == "group", "parent is not a group")
        seen = set()
        cursor = node_id
        while cursor is not None:
            require(cursor not in seen, "parent cycle")
            seen.add(cursor)
            require(len(seen) <= 8, "tree depth exceeds 8")
            require(cursor in nodes, "ancestor missing")
            cursor = nodes[cursor]["parentId"]
        parent = nodes[parent_id] if parent_id else None
        absolute = node["layout"]["mode"] == "absolute"
        require(not absolute or (parent is not None and parent["direction"] == "free"),
                "absolute node needs free parent")
        if parent and parent["direction"] == "free":
            require(absolute, "free group requires absolute children")
        if node["kind"] == "group":
            require((node["direction"] == "free") == ("viewBox" in node),
                    "viewBox is required only for free group")
        if node["kind"] == "shape" and node["shape"] == "circle":
            require(absolute and node["layout"]["width"] == node["layout"]["height"],
                    "circle requires square absolute bounds")
        for source in node.get("sourceRefs", []):
            require(source in resources["sources"], "source missing")
        for field, kind in (("assetId", node["kind"]), ("posterAssetId", "image"),
                            ("captionsAssetId", "captions")):
            if field in node:
                asset = resources["assets"].get(node[field])
                require(asset is not None and asset["kind"] == kind, "asset missing or wrong kind")

    for dataset in datasets.values():
        fields = index_unique(dataset["fields"], "name", "field")
        index_unique(dataset["rows"], "key", "row")
        for row in dataset["rows"]:
            require(set(row["values"]) == set(fields), "row fields do not match declaration")
            for name, value in row["values"].items():
                if value is None:
                    continue
                valid = (isinstance(value, str) if fields[name]["type"] == "string"
                         else isinstance(value, (int, float)) and not isinstance(value, bool))
                require(valid, "row value type mismatch")
                if isinstance(value, str):
                    require(len(value) <= 2000, "cell text exceeds 2000 characters")
    for node in nodes.values():
        if node["kind"] == "chart":
            require(node["datasetId"] in datasets, "chart dataset missing")
            fields = {f["name"]: f["type"] for f in datasets[node["datasetId"]]["fields"]}
            require(node["xField"] in fields and fields.get(node["yField"]) == "number",
                    "chart fields invalid")
            require(node["chartType"] != "bar" or node.get("zeroBaseline", True),
                    "bar must include zero baseline")

    animated = set()
    properties = set()
    for animation in draft["animations"]:
        require(animation["target"] in nodes, "animation target missing")
        target = nodes[animation["target"]]
        require(target["kind"] in ("shape", "group"), "animation target kind unsupported")
        require(target["layout"]["mode"] == "absolute" or
                (target["kind"] == "group" and target["direction"] == "free"),
                "animation target must be in a free figure")
        binding = (animation["target"], animation["property"])
        require(binding not in properties, "duplicate animated target property")
        properties.add(binding)
        animated.add(animation["target"])
        times = [frame["timeMs"] for frame in animation["keyframes"]]
        require(times[0] == 0 and times[-1] == animation["durationMs"],
                "keyframe endpoints invalid")
        require(all(a < b for a, b in zip(times, times[1:])), "keyframes not increasing")
        if animation["property"] == "opacity":
            require(all(0 <= frame["value"] <= 1 for frame in animation["keyframes"]),
                    "opacity outside 0..1")
    for action in draft["actions"]:
        require(action["target"] in nodes, "action target missing")
        target = nodes[action["target"]]
        if action["kind"] == "set-chart-type":
            require(target["kind"] == "chart", "chart action target invalid")
        if action["kind"] == "toggle-playback":
            require(target["kind"] == "video" or action["target"] in animated,
                    "playback target invalid")
    return True

def validate_host(tx, current_revision, answers, resources, previous=None):
    check_size(tx)
    check_schema(HOST_VALIDATOR, tx)
    require(tx["baseRevision"] == current_revision, "stale revision")
    require(tx["nextRevision"] == tx["baseRevision"] + 1, "revision must increment by one")
    if tx["mode"] in ("append", "insert"):
        require(tx["answerId"] not in answers, "append answer already exists")
    else:
        require(tx["answerId"] in answers, "replace/remove answer missing")
    if tx["mode"] == "insert":
        anchor = tx["beforeAnswerId"]
        require(anchor is None or (anchor in answers and anchor != tx["answerId"]), "invalid insertion anchor")
    if tx["draft"] is not None:
        validate_draft(tx["draft"], resources, previous)
    return True

def apply_answer_order(tx, order):
    result = list(order)
    if tx["mode"] == "remove":
        result.remove(tx["answerId"])
    elif tx["mode"] == "append":
        result.append(tx["answerId"])
    elif tx["mode"] == "insert":
        anchor = tx["beforeAnswerId"]
        position = len(result) if anchor is None else result.index(anchor)
        result.insert(position, tx["answerId"])
    return result

def read_json(name):
    return json.loads((ROOT / "examples" / name).read_text())

def main():
    for schema in (DRAFT_SCHEMA, HOST_SCHEMA):
        Draft202012Validator.check_schema(schema)
    resources = read_json("resource-registry.json")
    scenes = {n: read_json(n + ".json") for n in ("text", "chart", "motion-media")}
    for scene in scenes.values():
        validate_draft(scene, resources)
    host = read_json("host-transaction.json")
    validate_host(host, 0, set(), resources)

    restore = copy.deepcopy(host)
    restore.update(mode="insert", origin="undo", requestId=None,
                   answerId="answerB", beforeAnswerId="answerC")
    validate_host(restore, 0, {"answerA","answerC"}, resources)
    assert apply_answer_order(restore, ["answerA","answerC"]) == ["answerA","answerB","answerC"]
    negative = []
    def bad_scene(name, source, mutate, previous=None):
        value = copy.deepcopy(scenes[source])
        mutate(value)
        negative.append((name, lambda v=value, p=previous: validate_draft(v, resources, p)))
    bad_scene("model cannot set revision", "text", lambda x: x.update(nextRevision=3))
    bad_scene("no scripts", "text", lambda x: x["nodes"][1].update(script="alert(1)"))
    bad_scene("duplicate node identity", "text", lambda x: x["nodes"].append(copy.deepcopy(x["nodes"][1])))
    bad_scene("parent cycle", "text", lambda x: x["nodes"][0].update(parentId="answer"))
    bad_scene("missing parent", "text", lambda x: x["nodes"][1].update(parentId="unknown"))
    bad_scene("absolute without free parent", "text", lambda x: x["nodes"][1].update(layout={"mode":"absolute","x":0,"y":0,"width":100,"height":20}))
    bad_scene("missing dataset", "chart", lambda x: x["nodes"][2].update(datasetId="unknown"))
    bad_scene("string is not numeric data", "chart", lambda x: x["datasets"][0]["rows"][0]["values"].update(income="120"))
    bad_scene("duplicate row key", "chart", lambda x: x["datasets"][0]["rows"][1].update(key="year2023"))
    bad_scene("missing field is not null", "chart", lambda x: x["datasets"][0]["rows"][0]["values"].pop("income"))
    bad_scene("bar baseline cannot hide zero", "chart", lambda x: x["nodes"][2].update(zeroBaseline=False))
    bad_scene("missing asset", "motion-media", lambda x: x["nodes"][4].update(assetId="unknown"))
    bad_scene("bad animation endpoint", "motion-media", lambda x: x["animations"][0]["keyframes"][1].update(timeMs=2000))
    bad_scene("bad action target", "text", lambda x: x["actions"].append({"id":"badAction","target":"intro","kind":"set-chart-type","chartType":"line","label":"bad"}))
    bad_scene("nonfinite data", "chart", lambda x: x["datasets"][0]["rows"][0]["values"].update(income=float("nan")))
    bad_scene("missing source", "text", lambda x: x["nodes"][1].update(sourceRefs=["unknown"]))
    changed = copy.deepcopy(scenes["text"])
    changed["nodes"][1] = {"id":"intro","parentId":"answer","kind":"shape","shape":"rect","material":"accent","label":"changed","layout":{"mode":"flow"}}
    negative.append(("stable key cannot change kind", lambda: validate_draft(changed,resources,scenes["text"])))
    for name, mutate, revision, answers in (
        ("revision jump", lambda t:t.update(nextRevision=2), 0, set()),
        ("stale baseline", lambda t:None, 1, set()),
        ("duplicate append", lambda t:None, 0, {"answerFirst"}),
        ("replace missing answer", lambda t:t.update(mode="replace"), 0, set()),
        ("model cannot remove answer", lambda t:t.update(mode="remove",draft=None), 0, {"answerFirst"}),
    ):
        value = copy.deepcopy(host)
        mutate(value)
        negative.append((name, lambda v=value,r=revision,a=answers: validate_host(v,r,a,resources)))
    for name, anchor in (("missing insertion anchor", "absent"), ("self insertion anchor", "answerB")):
        value = copy.deepcopy(restore)
        value["beforeAnswerId"] = anchor
        negative.append((name, lambda v=value: validate_host(v,0,{"answerA","answerC"},resources)))
    for name, check in negative:
        try:
            check()
        except SpecError:
            pass
        else:
            raise AssertionError("invalid specimen accepted: " + name)
    print(json.dumps({"schemas":2,"positive_examples":5,"rejected_negative_cases":len(negative),
                      "scope":"design schema and semantic reference checks only"}, ensure_ascii=False))

if __name__ == "__main__":
    main()
