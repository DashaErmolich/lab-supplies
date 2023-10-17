const cds = require("@sap/cds");

module.exports = function (srv) {
  const { Orders, OrdersItems, WarehousesProducts } = srv.entities;

  this.before("NEW", Orders.drafts, async (req) => {
    req.data.status_ID = "OPENED";
  });

  this.before("CREATE", Orders, async (req) => {
    const data = new Date();
    req.data.title = `Order ${data.getDate()}/${data.getMinutes()}`;
  });

  this.before("SAVE", Orders, async (req) => {
    if (!req.data.items.length) {
      req.error({
        message: "Add at least one item to order",
      });
    } else {
      req.data.status_ID = "WAITING_FOR_APPROVE";
    }
  });

  this.on("SAVE", Orders, async (req, next) => {
    const currentOrderItems = req.data.items;
    const prevOrderItems = await SELECT.from(OrdersItems).where({
      order_ID: req.data.ID,
    });

    const diffForInserting = currentOrderItems.filter(
      ({ item_product_ID, item_warehouse_ID }) =>
        !prevOrderItems.some((item) => item.item_product_ID === item_product_ID && item.item_warehouse_ID === item_warehouse_ID)
    );

    const diffForDeletion = prevOrderItems.filter(
      ({ item_product_ID, item_warehouse_ID }) =>
      !currentOrderItems.some((item) => item.item_product_ID === item_product_ID && item.item_warehouse_ID === item_warehouse_ID)
    ).map((item) => ({...item, qty: item.qty * (-1)}));

    const diffForUpdate = prevOrderItems.filter(
      ({ item_product_ID, item_warehouse_ID, qty }) =>
      currentOrderItems.some((item) => item.item_product_ID === item_product_ID && item.item_warehouse_ID === item_warehouse_ID && item.qty !== qty)
    ).map((item) => {
      const current = currentOrderItems.find((v) => v.item_product_ID === item.item_product_ID && v.item_warehouse_ID === item.item_warehouse_ID);
      return { ...item, qty: current.qty - item.qty }
    });

    const all = [...diffForDeletion, ...diffForInserting, ...diffForUpdate]

    const final = [];

    for (let i = 0; i < all.length; i++) {
      const item = all[i];
      const data = await SELECT(WarehousesProducts, {
        warehouse_ID: item.item_warehouse_ID,
        product_ID: item.item_product_ID,
      });

      if (data.stock >= item.qty) {
        final.push({
          listItem: item,
          whItem: data,
        });
      } else {
        final.push(null);
      }
    }

    if (final.every((item) => item !== null)) {
      for (let i = 0; i < final.length; i++) {
        const item = final[i];
        try {
          await UPDATE(WarehousesProducts, {
            warehouse_ID: item.listItem.item_warehouse_ID,
            product_ID: item.listItem.item_product_ID,
          }).with({
            stock: item.whItem.stock - item.listItem.qty,
          });
        } catch (error) {
          console.log(error);
        }
      }
    } else {
      req.error({
        message: "Some items are unavailable",
      });
    }

    return next();
  });

  this.before("UPDATE", OrdersItems.drafts, async (req) => {
    if (!req.data.item_product_ID && !req.data.item_product_ID) {
      const one = await SELECT.one.from(OrdersItems.drafts, req.data.ID);
      const whp = await SELECT.one.from(WarehousesProducts, {
        product_ID: one.item_product_ID,
        warehouse_ID: one.item_warehouse_ID,
      });

      if (req.data.qty > whp.stock) {
        req.error({
          message: "There are no such items in stock",
          target: "qty",
        });
      } else if (req.data.qty <= 0) {
        req.error({
          message: "Enter the valid value",
          target: "qty",
        });
      }
    }
  });

  this.before("UPDATE", OrdersItems.drafts, async (req) => {
    if (req.data.item_product_ID && req.data.item_product_ID) {
      const whp = await SELECT.one.from(WarehousesProducts, {
        product_ID: req.data.item_product_ID,
        warehouse_ID: req.data.item_warehouse_ID,
      });

      if (!whp.stock) {
        req.warn({
          message: "This item is not available now",
        });
      } else {
        req.data.qty = null;
      }
    }
  });
};
