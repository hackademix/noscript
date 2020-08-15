if (UA.isMozilla) (() => {
  // see https://dxr.mozilla.org/mozilla-central/rev/d03b538b6b417ba892d0a92fd693945b741246e1/netwerk/streamconv/converters/nsIndexedToHTML.cpp#381
  'use strict';
  var gTable, gOrderBy, gTBody, gRows, gUI_showHidden;
  document.addEventListener("DOMContentLoaded", function() {
    if ("gUI_showHidden" in window.wrappedJSObject || // scripts are enabled
        !(document.scripts[0] &&
          /\bgUI_showHidden\b/.test(document.scripts[0].textContent)) // not a FTP dir listing
    ) {
      return;
    }

    gTable = document.getElementsByTagName("table")[0];
    gTBody = gTable.tBodies[0];
    if (gTBody.rows.length < 2)
      return;
    gUI_showHidden = document.getElementById("UI_showHidden")
    var headCells = gTable.tHead.rows[0].cells,
        hiddenObjects = false;
    function rowAction(i) {
      return function(event) {
        event.preventDefault();
        orderBy(i);
      }
    }
    for (var i = headCells.length - 1; i >= 0; i--) {
      var anchor = document.createElement("a");
      anchor.href = "";
      anchor.appendChild(headCells[i].firstChild);
      headCells[i].appendChild(anchor);
      headCells[i].addEventListener("click", rowAction(i), true);
    }
    if (gUI_showHidden) {
      gRows = Array.from(gTBody.rows);
      hiddenObjects = gRows.some(row => row.className == "hidden-object");
    }
    gTable.setAttribute("order", "");
    if (hiddenObjects) {
      gUI_showHidden.style.display = "block";
      updateHidden();
    }
  }, "false");
  function compareRows(rowA, rowB) {
    var a = rowA.cells[gOrderBy].getAttribute("sortable-data") || "";
    var b = rowB.cells[gOrderBy].getAttribute("sortable-data") || "";
    var intA = +a;
    var intB = +b;
    if (a == intA && b == intB) {
      a = intA;
      b = intB;
    } else {
      a = a.toLowerCase();
      b = b.toLowerCase();
    }
    if (a < b)
      return -1;
    if (a > b)
      return 1;
    return 0;
  }
  function orderBy(column) {
    if (!gRows)
      gRows = Array.from(gTBody.rows);
    var order;
    if (gOrderBy == column) {
      order = gTable.getAttribute("order") == "asc" ? "desc" : "asc";
    } else {
      order = "asc";
      gOrderBy = column;
      gTable.setAttribute("order-by", column);
      gRows.sort(compareRows);
    }
    gTable.removeChild(gTBody);
    gTable.setAttribute("order", order);
    if (order == "asc")
      for (var i = 0; i < gRows.length; i++)
        gTBody.appendChild(gRows[i]);
    else
      for (var i = gRows.length - 1; i >= 0; i--)
        gTBody.appendChild(gRows[i]);
    gTable.appendChild(gTBody);
  }
  function updateHidden() {
    gTable.className = gUI_showHidden.getElementsByTagName("input")[0].checked ?
                       "" :
                       "remove-hidden";
  }
})();
