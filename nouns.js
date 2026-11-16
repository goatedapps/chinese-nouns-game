function imageSlug(english) {
  const first = english.split("/")[0].trim();
  return first
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

function slugifyLabel(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function parseNouns(text) {
  const lines = text.split(/\r?\n/);
  const lists = [];
  let current = null;
  let order = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const heading = line.match(/^##\s*(.+)$/);
    if (heading) {
      const label = heading[1].replace(/^List\s+\d+\s*[—-]\s*/i, "").trim();
      current = { id: slugifyLabel(label), label, nouns: [] };
      lists.push(current);
      continue;
    }

    if (!current || !line.startsWith("|")) continue;

    let cells = line.split("|").map((c) => c.trim());
    if (cells[0] === "") cells.shift();
    if (cells[cells.length - 1] === "") cells.pop();
    if (cells.length < 3) continue;
    if (cells[0].toLowerCase() === "english") continue; // header row
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator row

    const [english, chinese, pinyin] = cells;
    const slug = imageSlug(english);
    current.nouns.push({
      english,
      chinese,
      pinyin,
      listId: current.id,
      listLabel: current.label,
      image: `assets/images/${slug}.png`,
      order: order++,
    });
  }

  return lists;
}

module.exports = { parseNouns };
