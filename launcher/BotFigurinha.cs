// BotFigurinha.exe: roda o bot (node bot.js) escondido, com ícone na bandeja do Windows.
// - reinicia o bot se ele cair
// - "Abrir painel" abre a interface numa janela própria (Edge em modo app)
// - BotFigurinha.exe --minimizado: só liga o bot, sem abrir o painel (usado ao iniciar o Windows)
// Compilar: launcher\compilar.bat
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

static class Programa
{
    const string Url = "http://127.0.0.1:3777";

    [STAThread]
    static void Main(string[] args)
    {
        bool minimizado = Array.Exists(args, a => a == "--minimizado");
        bool primeiro;
        using (var mutex = new Mutex(true, "BotFigurinha-Bandeja", out primeiro))
        {
            if (!primeiro)
            {
                // já está rodando: só abre o painel (aqui mesmo, antes de este processo terminar)
                Painel.AbrirAgora(Url);
                return;
            }
            Application.EnableVisualStyles();
            Application.Run(new Bandeja(Url, !minimizado));
        }
    }
}

class Bandeja : ApplicationContext
{
    // código que o bot.js usa quando já existe outra cópia rodando
    const int SaidaJaRodando = 3;

    readonly string pasta = AppDomain.CurrentDomain.BaseDirectory;
    readonly string url;
    readonly NotifyIcon icone;
    readonly System.Windows.Forms.Timer reinicio = new System.Windows.Forms.Timer();
    SynchronizationContext ui;
    Process bot;
    bool saindo;
    int quedasSeguidas;
    DateTime iniciadoEm;

    public Bandeja(string url, bool abrirPainel)
    {
        this.url = url;
        var menu = new ContextMenuStrip();
        var abrir = menu.Items.Add("Abrir painel", null, (s, e) => Painel.Abrir(url));
        abrir.Font = new Font(abrir.Font, FontStyle.Bold);
        menu.Items.Add("Abrir pasta das mídias", null, (s, e) => AbrirPasta());
        menu.Items.Add("Reiniciar bot", null, (s, e) => Reiniciar());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sair", null, (s, e) => Sair());

        icone = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath),
            Text = "Bot Figurinha",
            ContextMenuStrip = menu,
            Visible = true,
        };
        icone.DoubleClick += (s, e) => Painel.Abrir(url);
        // criar o menu instala o contexto da thread da bandeja; o aviso de queda do bot vem de outra thread
        ui = SynchronizationContext.Current;

        reinicio.Tick += (s, e) => { reinicio.Stop(); IniciarBot(); };

        if (!File.Exists(Path.Combine(pasta, "bot.js")))
        {
            MessageBox.Show("Não achei o bot.js em:\n" + pasta + "\n\nDeixe o BotFigurinha.exe na pasta do bot.",
                "Bot Figurinha", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Sair();
            return;
        }
        IniciarBot();
        if (abrirPainel) Painel.Abrir(url);
    }

    void IniciarBot()
    {
        if (saindo) return;
        var info = new ProcessStartInfo("node", "bot.js")
        {
            WorkingDirectory = pasta,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        try
        {
            bot = Process.Start(info);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            MessageBox.Show("Não encontrei o Node.js. Instale com:\n\nwinget install OpenJS.NodeJS.LTS",
                "Bot Figurinha", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Sair();
            return;
        }
        iniciadoEm = DateTime.Now;
        bot.EnableRaisingEvents = true;
        bot.Exited += (s, e) => { int codigo = ((Process)s).ExitCode; ui.Post(_ => Caiu(codigo), null); };
        icone.Text = "Bot Figurinha — rodando";
    }

    void Caiu(int codigo)
    {
        if (saindo) return;
        if (codigo == SaidaJaRodando)
        {
            icone.Text = "Bot Figurinha — já rodando fora do app";
            icone.ShowBalloonTip(5000, "Bot Figurinha",
                "O bot já está rodando em outra janela. O painel continua funcionando.", ToolTipIcon.Info);
            return;
        }
        // caiu logo depois de ligar várias vezes seguidas: espera mais para não ficar em loop
        quedasSeguidas = (DateTime.Now - iniciadoEm).TotalMinutes < 2 ? quedasSeguidas + 1 : 1;
        int segundos = quedasSeguidas >= 3 ? 60 : 5;
        icone.Text = "Bot Figurinha — reiniciando";
        if (quedasSeguidas == 3)
        {
            icone.ShowBalloonTip(5000, "Bot Figurinha",
                "O bot está caindo logo depois de ligar. Veja a Atividade no painel ou o bot.log.", ToolTipIcon.Warning);
        }
        reinicio.Interval = segundos * 1000;
        reinicio.Start();
    }

    void PararBot()
    {
        try
        {
            if (bot != null && !bot.HasExited)
            {
                bot.EnableRaisingEvents = false;
                bot.Kill();
                bot.WaitForExit(5000);
            }
        }
        catch { }
    }

    void Reiniciar()
    {
        PararBot();
        quedasSeguidas = 0;
        IniciarBot();
        icone.ShowBalloonTip(2000, "Bot Figurinha", "Bot reiniciado.", ToolTipIcon.Info);
    }

    void AbrirPasta()
    {
        string midia = Path.Combine(pasta, "midia");
        Directory.CreateDirectory(midia);
        Process.Start("explorer.exe", "\"" + midia + "\"");
    }

    void Sair()
    {
        saindo = true;
        reinicio.Stop();
        PararBot();
        icone.Visible = false;
        ExitThread();
    }
}

static class Painel
{
    // espera o painel responder (o bot pode estar ligando) e abre numa janela própria
    public static void Abrir(string url)
    {
        new Thread(() => AbrirAgora(url)) { IsBackground = true }.Start();
    }

    public static void AbrirAgora(string url)
    {
        for (int i = 0; i < 40 && !Responde(url); i++) Thread.Sleep(500);
        string navegador = AcharNavegador();
        try
        {
            if (navegador != null) Process.Start(navegador, "--app=" + url + " --window-size=1280,860");
            else Process.Start(url);
        }
        catch
        {
            try { Process.Start(url); } catch { }
        }
    }

    static bool Responde(string url)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url + "/api/estado");
            req.Timeout = 1000;
            using (var res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    static string AcharNavegador()
    {
        string[] candidatos =
        {
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            Environment.ExpandEnvironmentVariables(@"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        };
        return Array.Find(candidatos, File.Exists);
    }
}
