// Atalho executável para o bot: abre o iniciar-bot.bat que está na mesma pasta do .exe.
// Compilar: launcher\compilar.bat
using System;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Windows.Forms;

static class BotFigurinha
{
    [STAThread]
    static void Main()
    {
        string pasta = AppDomain.CurrentDomain.BaseDirectory;
        string bat = Path.Combine(pasta, "iniciar-bot.bat");

        if (!File.Exists(bat))
        {
            MessageBox.Show("Não achei o iniciar-bot.bat em:\n" + pasta +
                "\n\nDeixe o BotFigurinha.exe na mesma pasta do bot.",
                "Bot Figurinha", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        // duas cópias conectadas ao mesmo tempo brigam pela sessão do WhatsApp
        if (BotRodando())
        {
            MessageBox.Show("O bot já está aberto (janela \"Bot Figurinha\").",
                "Bot Figurinha", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        Process.Start(new ProcessStartInfo(bat) { WorkingDirectory = pasta, UseShellExecute = true });
    }

    static bool BotRodando()
    {
        try
        {
            using (var busca = new ManagementObjectSearcher(
                "SELECT CommandLine FROM Win32_Process WHERE Name = 'node.exe'"))
            {
                foreach (ManagementObject p in busca.Get())
                {
                    string cmd = p["CommandLine"] as string;
                    if (cmd != null && cmd.Contains("bot.js")) return true;
                }
            }
        }
        catch
        {
            // se não der para verificar, abre mesmo assim
        }
        return false;
    }
}
