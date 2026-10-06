// Мост PS1 Viewer ⇄ three.js Editor: модель приезжает из вьюера (window.opener.__ps1Bridge.outgoing),
// кнопка «↩ Вернуть в PS1 Viewer» экспортирует сцену в GLB (с анимациями) и отдаёт её обратно.
import { GLTFExporter } from '../examples/jsm/exporters/GLTFExporter.js';

const editor = window.editor;
const incoming = window.__ps1Incoming;

function bar() {
	const b = document.createElement( 'div' );
	b.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:9999;display:flex;gap:8px;align-items:center;' +
		'background:#14110f;border:1px solid #c98a3a;padding:8px 12px;font:13px monospace;color:#e8e0cf;box-shadow:0 4px 18px #0008';
	b.innerHTML = '<span>PS1 Viewer</span><button id="ps1Back" style="background:#c98a3a;color:#140f0a;border:0;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer">↩ Вернуть в PS1 Viewer</button>';
	document.body.appendChild( b );
	b.querySelector( '#ps1Back' ).onclick = send;
}

function send() {
	const target = window.opener?.__ps1Bridge;
	if ( ! target ) { alert( 'Вкладка PS1 Viewer закрыта. Экспортируй GLB через File → Export и загрузи его во вьюере кнопкой «Загрузить».' ); return; }
	const scene = editor.scene;
	const animations = [];
	scene.traverse( ( o ) => animations.push( ...o.animations ) );
	new GLTFExporter().parse( scene, ( buffer ) => {
		target.receive( { kind: 'glb', buffer, name: incomingName } );
		window.opener.focus?.();
		alert( 'Готово: модель отправлена в PS1 Viewer. Эту вкладку можно закрыть.' );
	}, ( e ) => alert( 'Ошибка экспорта: ' + e.message ), { binary: true, animations } );
}

if ( window.opener ) bar();

let incomingName = 'Моя модель';
if ( incoming ) {
	const data = await incoming;
	incomingName = data.name || incomingName;
	editor.clear();
	editor.loader.loadFiles( [ new File( [ data.buffer ], incomingName + '.glb' ) ] );
}
