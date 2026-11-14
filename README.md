# 🎧 Glass Music

PWA de streaming musical com interface **Glassmorphism**, reprodução em segundo plano e proxy de áudio self-hosted. O projeto usa JavaScript nativo com ES Modules, Node.js/Express no backend e `yt-dlp` para extrair streams de áudio do YouTube sob demanda.

> **Status:** projeto experimental/educacional. O catálogo, previews, letras e streams dependem de serviços externos e podem sofrer limitações de disponibilidade, região, CORS ou mudanças de API.

## ✨ Funcionalidades

- Busca de músicas pelo catálogo público do iTunes Search API.
- Cards responsivos com capa, artista, álbum e duração.
- Reprodução por proxy Node.js com `yt-dlp`.
- Fallback automático para o preview de aproximadamente 30 segundos do iTunes quando o proxy não estiver disponível.
- Streaming com `HTTP Range` e respostas `206 Partial Content`, permitindo seek eficiente.
- Cache no servidor das URLs diretas de áudio por 30 minutos.
- Busca e exibição de letras via LRCLIB, incluindo letras sincronizadas no formato LRC.
- Fila de reprodução, próximo/anterior, shuffle e modos de repetição.
- Favoritos, histórico e playlists persistidos no `localStorage`.
- Media Session API para controles na tela de bloqueio e notificações.
- PWA instalável com manifest e Service Worker.
- Tema Glassmorphism com cor de destaque, opacidade, blur e modo OLED.
- Favicon SVG e layout adaptado para desktop e dispositivos móveis.
- Autodetecção do proxy: quando a aplicação está em HTTPS, usa `window.location.origin`.

## 🧱 Arquitetura

```text
GlassMusic/
├── package.json
├── package-lock.json
├── .env.example
├── .gitignore
├── public/
│   ├── index.html
│   ├── glassmusic.svg
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── styles/
│   │   ├── tokens.css
│   │   ├── glass.css
│   │   ├── layout.css
│   │   └── components.css
│   └── js/
│       ├── main.js
│       ├── core/
│       │   ├── store.js
│       │   ├── audioEngine.js
│       │   └── themeEngine.js
│       ├── services/
│       │   ├── itunesService.js
│       │   ├── lrclibService.js
│       │   └── storageService.js
│       └── ui/
│           ├── dom.js
│           ├── renderers.js
│           └── events.js
└── server/
    ├── index.js
    └── services/
        └── youtubeProxy.js
```

### Fluxo de reprodução

1. O frontend consulta o iTunes e obtém metadados imutáveis da faixa.
2. Ao tocar, o frontend chama `/api/stream` com artista, título e duração.
3. O backend usa `yt-search` e prioriza resultados de canais com sufixo `- Topic`.
4. Apenas vídeos cuja duração esteja dentro de ±5 segundos são aceitos.
5. `yt-dlp` extrai a URL direta do formato de áudio.
6. A URL direta é reutilizada por até 30 minutos.
7. O backend repassa `Range`, `Content-Range`, `Content-Length` e `Accept-Ranges`.
8. Se o stream falhar, o frontend verifica `/api/health` silenciosamente por até 4 segundos antes de tentar novamente ou usar o preview do iTunes.

## 📋 Requisitos

- Node.js 18 ou superior.
- npm.
- `yt-dlp` instalado e acessível no `PATH`.
- Acesso à internet para iTunes, LRCLIB e YouTube.
- Navegador moderno com suporte a ES Modules, Service Worker e Media Session API.

O `yt-dlp` também pode ser apontado manualmente por `YTDLP_PATH`.

### Instalar o yt-dlp

#### Windows

```powershell
py -m pip install --user yt-dlp
yt-dlp --version
```

Se o executável não estiver no `PATH`, descubra o caminho:

```powershell
Get-Command yt-dlp -ErrorAction SilentlyContinue
```

Depois defina o caminho completo em `.env`, por exemplo:

```env
YTDLP_PATH=C:\Users\seu-usuario\AppData\Roaming\Python\Python312\Scripts\yt-dlp.exe
```

#### Ubuntu/Debian

```bash
sudo apt update
sudo apt install -y python3-pip
python3 -m pip install --break-system-packages yt-dlp
yt-dlp --version
```

## 🚀 Instalação local

Clone o repositório e instale as dependências:

```bash
git clone https://github.com/SEU_USUARIO/GlassMusic.git
cd GlassMusic
npm install
```

Crie o arquivo de ambiente:

```bash
cp .env.example .env
```

No PowerShell:

```powershell
Copy-Item .env.example .env
```

Edite `.env`:

```env
PORT=3001
FRONTEND_ORIGIN=http://localhost:3001
YTDLP_PATH=yt-dlp
YOUTUBE_COOKIES=
```

Inicie o servidor:

```bash
npm start
```

Abra:

```text
http://localhost:3001
```

O próprio Express serve o frontend e o backend no mesmo origin. Também é possível abrir `public/index.html` por um servidor estático durante o desenvolvimento, mas o proxy deverá estar disponível e o navegador poderá aplicar regras de CORS.

## 🧪 Verificação

O projeto possui uma verificação de sintaxe para os módulos principais:

```bash
npm run check
```

Teste o health check:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/health
```

Resposta esperada:

```json
{
  "ok": true,
  "service": "glass-music-proxy"
}
```

Teste uma requisição de áudio com Range:

```bash
curl -I \
  -H "Range: bytes=0-1023" \
  "http://localhost:3001/api/stream?artist=Mac%20DeMarco&title=Chamber%20Of%20Reflection&duration=232"
```

Uma resposta funcional deve conter `206 Partial Content`, `Content-Range` e `Accept-Ranges`.

## 🔌 API do backend

### `GET /health`

Endpoint de compatibilidade para health check.

### `GET /api/health`

Endpoint usado pelo frontend para definir o estado `ONLINE`, `OFFLINE` ou `VERIFICANDO`.

### `GET /api/stream`

Parâmetros:

| Parâmetro | Obrigatório | Descrição |
|---|---:|---|
| `artist` | sim | Nome do artista |
| `title` | sim | Título da música |
| `duration` | sim | Duração esperada em segundos |

Exemplo:

```text
/api/stream?artist=Mac%20DeMarco&title=Chamber%20Of%20Reflection&duration=232
```

Headers aceitos:

- `Range`: repassado ao upstream para seek.
- `X-Audio-Quality`: indicador técnico de qualidade solicitado pelo cliente.

Erros de extração ou upstream retornam `502 Bad Gateway` com JSON:

```json
{
  "error": "stream_unavailable",
  "message": "..."
}
```


## 🔐 Segurança e privacidade

- Nunca versione `.env`, cookies, chaves `.pem`, tokens ou credenciais.
- O `.gitignore` já exclui esses arquivos e também `node_modules`.
- URLs diretas temporárias do YouTube não são gravadas no `localStorage`; o cache existe somente na memória do processo Node.js.
- O frontend salva apenas metadados de músicas, favoritos, histórico, playlists e preferências.
- Dados externos são escapados antes de serem inseridos em HTML.
- O endpoint de stream deve ser protegido por CORS, rate limiting e autenticação adicional se for exposto publicamente.
- Cookies do YouTube devem permanecer somente no servidor e nunca ser enviados ao navegador.
- Revogue imediatamente qualquer chave que tenha sido exposta ou publicada por engano.

## 📱 PWA e Service Worker

O App Shell é definido em `public/sw.js`. O Service Worker:

- faz cache dos arquivos estáticos essenciais;
- ignora requisições para `/api/`;
- ignora domínios externos;
- usa fallback de cache quando um recurso local falha;
- exige HTTPS em produção para ser registrado corretamente.

Depois de alterar arquivos públicos em produção, incremente `CACHE_NAME` em `public/sw.js` ou limpe os dados do site no navegador para evitar cache antigo.

## 🧩 Serviços externos

- **iTunes Search API:** metadados, capas e previews.
- **LRCLIB:** letras simples e sincronizadas.
- **YouTube + yt-dlp:** origem do stream integral.

Esses serviços possuem políticas, limites e disponibilidade próprios. Verifique os termos de uso e os direitos de reprodução aplicáveis à sua região e ao conteúdo utilizado.

## 🛠️ Solução de problemas

### O proxy aparece como OFFLINE

Verifique:

```bash
curl https://seu-dominio/api/health
```

Confira `PORT`, o proxy reverso, CORS e os logs do processo Node.js.

### `/api/stream` retorna 502

- Execute `yt-dlp --version`.
- Confira `YTDLP_PATH`.
- Verifique se o vídeo correspondente existe e está acessível.
- Confirme se a duração enviada está correta; o filtro aceita somente ±5 segundos.
- Se o YouTube exigir autenticação, configure `YOUTUBE_COOKIES` no servidor.

### A música toca somente por 30 segundos

Isso indica normalmente o fallback para `previewUrl` do iTunes. Consulte `/api/health`, os logs do backend e a disponibilidade do `yt-dlp`. O preview do iTunes é intencionalmente limitado e não substitui o stream do proxy.

### O navegador continua exibindo a versão antiga

Faça um hard reload, remova o Service Worker em DevTools e limpe o cache do site. Em produção, atualize o `CACHE_NAME` do Service Worker.


## 📄 Scripts npm

| Script | Função |
|---|---|
| `npm start` | Inicia o servidor Express |
| `npm run check` | Verifica a sintaxe dos módulos JavaScript |

## 🤝 Contribuição

1. Faça um fork do projeto.
2. Crie uma branch descritiva:

   ```bash
   git checkout -b feat/minha-melhoria
   ```

3. Faça alterações pequenas e documentadas.
4. Execute `npm run check`.
5. Abra um Pull Request descrevendo comportamento, testes e eventuais mudanças de configuração.
