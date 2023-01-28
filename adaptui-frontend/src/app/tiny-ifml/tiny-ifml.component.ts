import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';

declare var mxGraph: any;
declare var mxPoint: any;
declare var mxUtils: any;
declare var mxRubberband: any;
declare var mxConstants: any;
declare var mxCylinder: any;
declare var mxCellRenderer: any;
declare var mxClient: any;
declare var mxGraphModel: any;
declare var mxEvent: any;
declare var mxConnectionHandler:any;
declare var mxImage: any;
declare var mxToolbar: any;
declare var mxDivResizer: any;
declare var mxKeyHandler: any;
declare var mxCell: any;
declare var mxGeometry: any;
declare var mxHierarchicalLayout: any;

@Component({
  selector: 'app-tiny-ifml',
  templateUrl: './tiny-ifml.component.html',
  styleUrls: ['./tiny-ifml.component.sass']
})
export class TinyIfmlComponent implements OnInit {

  @ViewChild("graphContainer")
  containerElementRef!: ElementRef;

  @ViewChild("graphContainer")
  toolbarElementRef!: ElementRef

  constructor() { }

  ngOnInit(): void {
  }

  get container() {
    return this.containerElementRef.nativeElement;
  }
  get toolbar() {
    return this.toolbarElementRef.nativeElement;
  }

  addToolbarItem(graph:any, toolbar:any, prototype:any, image:any)
  {
    // Function that is executed when the image is dropped on
    // the graph. The cell argument points to the cell under
    // the mousepointer if there is one.
    var funct = function(graph:any, evt:any, cell:any, x:any, y:any)
    {
      graph.stopEditing(false);

      var vertex = graph.getModel().cloneCell(prototype);
      vertex.geometry.x = x;
      vertex.geometry.y = y;

      graph.addCell(vertex);
      graph.setSelectionCell(vertex);
    }

    // Creates the image which is used as the drag icon (preview)
    var img = toolbar.addMode(null, image, function(evt:any, cell:any)
    {
      var pt = graph.getPointForEvent(evt);
      funct(graph, evt, cell, pt.x, pt.y);
    });

    // Disables dragging if element is disabled. This is a workaround
    // for wrong event order in IE. Following is a dummy listener that
    // is invoked as the last listener in IE.
    mxEvent.addListener(img, 'mousedown', function(evt:any)
    {
      // do nothing
    });

    // This listener is always called first before any other listener
    // in all browsers.
    mxEvent.addListener(img, 'mousedown', function(evt:any)
    {
      if (img.enabled == false)
      {
        mxEvent.consume(evt);
      }
    });

    mxUtils.makeDraggable(img, graph, funct);

    return img;
  }

  ngAfterViewInit(): void {
    var tinyIFML = this;
    // Creates the graph inside the given container
    if (!mxClient.isBrowserSupported())
    {
      // Displays an error message if the browser is
      // not supported.
      mxUtils.error('Browser is not supported!', 200, false);
    }
    else
    {
      // Defines an icon for creating new connections in the connection handler.
      // This will automatically disable the highlighting of the source vertex.
      mxConnectionHandler.prototype.connectImage = new mxImage('images/connector.gif', 16, 16);

      // Creates new toolbar without event processing
      var toolbar = new mxToolbar(this.toolbar);
      toolbar.enabled = false

      // Workaround for Internet Explorer ignoring certain styles
      if (mxClient.IS_QUIRKS)
      {
        document.body.style.overflow = 'hidden';
        new mxDivResizer(this.toolbar);
        new mxDivResizer(this.container);
      }

      // Creates the model and the graph inside the container
      // using the fastest rendering available on the browser
      var model = new mxGraphModel();
      var graph = new mxGraph(this.container, model);

      // Enables new connections in the graph
      graph.setConnectable(true);
      graph.setMultigraph(false);

      // Stops editing on enter or escape keypress
      var keyHandler = new mxKeyHandler(graph);
      var rubberband = new mxRubberband(graph);

      var addVertex = function(icon:any, w:any, h:any, style:any)
      {
        var vertex = new mxCell(null, new mxGeometry(0, 0, w, h), style);
        vertex.setVertex(true);

        var img = tinyIFML.addToolbarItem(graph, toolbar, vertex, icon);
        img.enabled = true;

        graph.getSelectionModel().addListener(mxEvent.CHANGE, function()
        {
          var tmp = graph.isSelectionEmpty();
          mxUtils.setOpacity(img, (tmp) ? 100 : 20);
          img.enabled = tmp;
        });
      };

      addVertex('assets/fill.png', 1000, 700, 'viewContainerStyle');
      addVertex('assets/fill.png', 400, 400, 'viewComponentStyle');
      addVertex('assets/fill.png', 300, 50, 'generatorAnnotation');
    }
    graph.vertexLabelsMovable = true;

    // Gets the default parent for inserting new cells. This
    // is normally the first child of the root (ie. layer 0).

    // Gets the default parent for inserting new cells. This
    // is normally the first child of the root (ie. layer 0).
    var parent = graph.getDefaultParent();

    function BoxShape(this: any)
    {
       mxCylinder.call(this);
    };
    mxUtils.extend(BoxShape, mxCylinder);
    BoxShape.prototype.extrude = 10;
    BoxShape.prototype.redrawPath = function(path: { moveTo: (arg0: number, arg1: number) => void; lineTo: (arg0: number, arg1: number) => void; close: () => void; }, x: any, y: any, w: any, h: number, isForeground: any)
    {
       var dy = this.extrude * this.scale;
       var dx = this.extrude * this.scale;
       path.moveTo(0, 0);
       path.lineTo(w, 0);
       path.lineTo(w, 0.1*h);
       path.lineTo(0, 0.1*h);
       path.moveTo(w, 0);
       path.lineTo(w, h);
       path.lineTo(0, h);
       path.lineTo(0, 0);
       path.close()
       //path.moveTo(0, dy);
       //path.lineTo(w - dx, dy);
    };
    mxCellRenderer.registerShape('box', BoxShape);

    var viewContainerStyle = new Object() as any;
    viewContainerStyle[mxConstants.STYLE_SHAPE] = 'box';
    viewContainerStyle[mxConstants.STYLE_STROKECOLOR] = '#000000';
    viewContainerStyle[mxConstants.STYLE_FONTCOLOR] = '#000000';
    viewContainerStyle[mxConstants.STYLE_SPACING_TOP] = BoxShape.prototype.extrude;
    viewContainerStyle[mxConstants.STYLE_SPACING_RIGHT] = BoxShape.prototype.extrude;

    viewContainerStyle[mxConstants.STYLE_FONTSIZE] = 20;
    viewContainerStyle[mxConstants.STYLE_FILLCOLOR] = '#FFFFFF';

    var viewComponentStyle = new Object() as any;
    viewComponentStyle[mxConstants.STYLE_STROKECOLOR] = '#000000';
    viewComponentStyle[mxConstants.STYLE_FONTCOLOR] = '#000000';

    viewComponentStyle[mxConstants.STYLE_FONTSIZE] = 20;
    viewComponentStyle[mxConstants.STYLE_FILLCOLOR] = '#FFFFFF';

    var generatorAnnotation = new Object() as any;
    generatorAnnotation[mxConstants.STYLE_STROKECOLOR] = '#000000';
    generatorAnnotation[mxConstants.STYLE_FONTCOLOR] = '#000000';

    generatorAnnotation[mxConstants.STYLE_FONTSIZE] = 12;
    generatorAnnotation[mxConstants.STYLE_FILLCOLOR] = '#ffffaa';

    graph.getStylesheet().putCellStyle('viewContainerStyle', viewContainerStyle);
    graph.getStylesheet().putCellStyle('viewComponentStyle', viewComponentStyle);
    graph.getStylesheet().putCellStyle('generatorAnnotation', generatorAnnotation);

    // Checks if browser is supported

    // Adds cells to the model in a single step
    graph.getModel().beginUpdate();
    try
    {
       var v1 = graph.insertVertex(parent, null,
                'View Container', 200, 150, 1000, 700, 'viewContainerStyle');
       v1.geometry.offset = new mxPoint(0, -700/2+50);

       var v2 = graph.insertVertex(v1, null,
                'View', 200, 150, 400, 400, 'viewComponentStyle');

       var v3 = graph.insertVertex(v2, null,
                'ADAPTUI-ANOTATION-STYLE=EDIT\nADAPTUI-ANOTATION-SCROLL=ON', 100, 0, 300, 50, 'generatorAnnotation');
    }
    finally
    {
       // Updates the display
       graph.getModel().endUpdate();
    }
 }

}
