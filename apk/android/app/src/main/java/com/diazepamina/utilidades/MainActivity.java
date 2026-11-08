package com.diazepamina.utilidades;

import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // «Abrir con Utilidades» (un PDF o una imagen que otra app abre con ACTION_VIEW, como
    // hace Aules) se trata igual que «Compartir con Utilidades»: se convierte en un
    // ACTION_SEND con el archivo, que es lo que entiende el plugin de recibir
    // (@capgo/capacitor-share-target). Capacitor llama a onNewIntent también al arrancar
    // en frío (BridgeActivity.load), así que vale para la app abierta y para la cerrada.
    @Override
    protected void onNewIntent(Intent intent) {
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            String esquema = intent.getData().getScheme();
            if ("content".equals(esquema) || "file".equals(esquema)) {
                Intent enviar = new Intent(Intent.ACTION_SEND);
                enviar.setType(intent.getType() != null ? intent.getType() : "application/pdf");
                enviar.putExtra(Intent.EXTRA_STREAM, intent.getData());
                enviar.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                intent = enviar;
            }
        }
        super.onNewIntent(intent);
        // Ya entregado a la app: si Android rehace la actividad, no se vuelve a importar.
        if (intent != null && (Intent.ACTION_SEND.equals(intent.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()))) {
            setIntent(new Intent(Intent.ACTION_MAIN));
        }
    }
}
