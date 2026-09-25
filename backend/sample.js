import { randomUUID } from "node:crypto";

const code = `import torch
from torch import nn


class MultiHeadAttention(nn.Module):
    """A small attention block to explore, line by line."""

    def __init__(self, dim=64, num_heads=4):
        super().__init__()
        self.num_heads = num_heads
        self.head_dim = dim // num_heads
        self.scale = self.head_dim ** -0.5
        self.qkv = nn.Linear(dim, dim * 3)
        self.proj = nn.Linear(dim, dim)

    def forward(self, x):
        B, N, D = x.shape

        # Project tokens into queries, keys and values
        qkv = self.qkv(x)
        qkv = qkv.reshape(B, N, 3, self.num_heads, self.head_dim)
        qkv = qkv.permute(2, 0, 3, 1, 4)
        q, k, v = qkv.unbind(0)

        # Scaled dot-product attention
        scores = (q @ k.transpose(-2, -1)) * self.scale
        attn = scores.softmax(dim=-1)

        # Aggregate values, then merge attention heads
        out = attn @ v
        out = out.transpose(1, 2).reshape(B, N, D)
        return self.proj(out)


if __name__ == "__main__":
    model = MultiHeadAttention()
    x = torch.randn(1, 10, 64)
    print(model(x).shape)  # torch.Size([1, 10, 64])
`;
// A deliberately ordinary SVG: bindings do not depend on clickable nodes or IDs.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="1110" viewBox="0 0 680 1110">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#9ba5b5"/></marker></defs>
<rect width="680" height="1110" fill="#fafbfe"/>
<g font-family="system-ui, sans-serif" font-size="14" text-anchor="middle" fill="#293347">
<text x="340" y="40" font-size="13" fill="#7a8498">MULTI-HEAD SELF-ATTENTION</text>
<g fill="none" stroke="#aab3c3" stroke-width="1.6" marker-end="url(#arrow)">
<path d="M340 108V153M340 225V270M340 328V365M340 419V449M340 578V625M340 695V742M340 812V852M340 922V962M340 1032V1070"/>
<path d="M340 449H177V487M340 449V487M340 449H503V487M177 543V603H298V625M340 543V603H382V625M503 543V777H452"/>
</g>
<rect x="253" y="68" width="174" height="40" rx="20" fill="#ecf0f7" stroke="#d3dbe7"/><text x="340" y="93">x · 1 × 10 × 64</text>
<rect x="228" y="153" width="224" height="72" rx="7" fill="#eeeaff" stroke="#b4a8ef"/><text x="340" y="180" font-weight="600">Linear · QKV</text><text x="340" y="205" font-size="12" fill="#81739e">64 → 192</text>
<rect x="228" y="270" width="224" height="58" rx="7" fill="#edf4fc" stroke="#b4cee6"/><text x="340" y="295" font-weight="600">Reshape</text><text x="340" y="314" font-size="12" fill="#72879d">1 × 10 × 3 × 4 × 16</text>
<rect x="228" y="365" width="224" height="54" rx="7" fill="#edf4fc" stroke="#b4cee6"/><text x="340" y="389" font-weight="600">Permute</text><text x="340" y="407" font-size="12" fill="#72879d">3 × 1 × 4 × 10 × 16</text>
<rect x="120" y="487" width="114" height="56" rx="7" fill="#ebf7f4" stroke="#a2d9cf"/><text x="177" y="511" font-weight="600">Q</text><text x="177" y="531" font-size="11">1 × 4 × 10 × 16</text>
<rect x="283" y="487" width="114" height="56" rx="7" fill="#ebf7f4" stroke="#a2d9cf"/><text x="340" y="511" font-weight="600">K</text><text x="340" y="531" font-size="11">1 × 4 × 10 × 16</text>
<rect x="446" y="487" width="114" height="56" rx="7" fill="#ebf7f4" stroke="#a2d9cf"/><text x="503" y="511" font-weight="600">V</text><text x="503" y="531" font-size="11">1 × 4 × 10 × 16</text>
<rect x="228" y="625" width="224" height="70" rx="7" fill="#fff3e5" stroke="#e3bf8a"/><text x="340" y="653" font-weight="600">MatMul + Scale</text><text x="340" y="679" font-size="12" fill="#9c7b50">Q · Kᵀ / √16 → Softmax</text>
<rect x="228" y="742" width="224" height="70" rx="7" fill="#fff3e5" stroke="#e3bf8a"/><text x="340" y="770" font-weight="600">MatMul · Attention × V</text><text x="340" y="795" font-size="12" fill="#9c7b50">1 × 4 × 10 × 16</text>
<rect x="228" y="852" width="224" height="70" rx="7" fill="#edf4fc" stroke="#b4cee6"/><text x="340" y="880" font-weight="600">Transpose + Reshape</text><text x="340" y="905" font-size="12" fill="#72879d">1 × 10 × 64</text>
<rect x="228" y="962" width="224" height="70" rx="7" fill="#eeeaff" stroke="#b4a8ef"/><text x="340" y="990" font-weight="600">Linear · Projection</text><text x="340" y="1015" font-size="12" fill="#81739e">64 → 64</text>
<text x="340" y="1094" font-size="13" fill="#7a8498">OUTPUT · 1 × 10 × 64</text>
</g></svg>`;

export function demoProject(name = "Multi-Head Attention") {
  const fileId = randomUUID();
  const make = (
    name,
    startLine,
    endLine,
    x,
    y,
    width,
    height,
    color,
    note = "",
  ) => ({
    id: randomUUID(),
    name,
    code: { file: "attention.py", startLine, endLine },
    svgRegion: { x, y, width, height },
    color,
    note,
  });
  return {
    name,
    files: [{ id: fileId, name: "attention.py", content: code }],
    svg: { name: "attention.svg", content: svg },
    bindings: [
      make(
        "QKV Projection",
        20,
        20,
        220,
        145,
        240,
        88,
        "#8978ff",
        "### QKV Projection\n\n一次线性投影同时生成查询、键和值。\n\n$$[Q,K,V] = XW_{qkv} + b$$\n\n输入：`(B, N, 64)`，输出：`(B, N, 192)`。",
      ),
      make(
        "Split attention heads",
        21,
        23,
        111,
        262,
        458,
        290,
        "#22bda3",
        "### 拆分多头\n\n把 64 维特征拆为 4 个头，每个头 16 维。`reshape` 和 `permute` 改变数据的组织方式。",
      ),
      make(
        "Scaled dot-product",
        26,
        27,
        220,
        617,
        240,
        86,
        "#eea34a",
        "### 注意力权重\n\n$$A=\\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)$$\n\n每个查询都对所有键计算相似度。",
      ),
      make("Aggregate values", 30, 31, 220, 734, 240, 196, "#4c9cf3"),
      make("Output projection", 32, 32, 220, 954, 240, 86, "#e576b3"),
    ],
    ui: {
      activeFileId: fileId,
      split: 46,
      theme: "dark",
      showCode: false,
      camera: null,
      selectedBindingId: null,
      editorViews: {},
      portraitTab: "code",
    },
  };
}
