(function($, $$) {

var _ = Mavo.Expressions = $.Class({
	constructor: function(mavo) {
		this.mavo = mavo;

		this.expressions = [];

		var syntax = Mavo.Expression.Syntax.create(this.mavo.element.closest("[mv-expressions]")) || Mavo.Expression.Syntax.default;
		this.traverse(this.mavo.element, undefined, syntax);

		this.scheduled = new Set();

		// Watch changes and update value
		this.mavo.treeBuilt.then(() => {
			for (let et of this.expressions) {
				et.group = Mavo.Node.get(et.element.closest(Mavo.selectors.group));
				et.group.expressions = et.group.expressions || [];
				et.group.expressions.push(et);

				var mavoNode = Mavo.Node.get(et.element, true);

				if (mavoNode && mavoNode instanceof Mavo.Primitive && mavoNode.attribute == et.attribute) {
					et.primitive = mavoNode;
					mavoNode.store = mavoNode.store || "none";
					mavoNode.modes = "read";
				}
			}

			this.mavo.element.addEventListener("mavo:datachange", evt => {
				if (evt.action == "propertychange" && evt.node.closestCollection) {
					// Throttle propertychange events in collections
					if (!this.scheduled.has(evt.property)) {
						setTimeout(() => {
							this.scheduled.delete(evt.property);
							this.update(evt);
						}, _.PROPERTYCHANGE_THROTTLE);

						this.scheduled.add(evt.property);
					}
				}
				else {
					requestAnimationFrame(() => this.update(evt));
				}
			});

			this.update();
		});
	},

	update: function callee(evt) {
		var data = this.mavo.root.getData({
			relative: true,
			store: "*",
			null: true,
			unhandled: this.mavo.unhandled
		});

		this.mavo.walk((obj, path) => {
			if (obj instanceof Mavo.Group && obj.expressions && obj.expressions.length && !obj.isDeleted()) {
				let env = { context: this, data: $.value(data, ...path) };

				Mavo.hooks.run("expressions-update-start", env);

				for (let et of obj.expressions) {
					if (et.changedBy(evt)) {
						et.update(env.data, evt);
					}
				}
			}
		});
	},

	extract: function(node, attribute, path, syntax) {
		if (attribute && attribute.name == "mv-expressions") {
			return;
		}

		if ((attribute && _.directives.indexOf(attribute.name) > -1) ||
		    syntax.test(attribute? attribute.value : node.textContent)
		) {
			this.expressions.push(new Mavo.Expression.Text({
				node, syntax,
				path: path? path.slice(1).split("/").map(i => +i) : [],
				attribute: attribute && attribute.name,
				mavo: this.mavo
			}));
		}
	},

	// Traverse an element, including attribute nodes, text nodes and all descendants
	traverse: function(node, path = "", syntax) {
		if (node.nodeType === 8) {
			// We don't want expressions to be picked up from comments!
			// Commenting stuff out is a common debugging technique
			return;
		}

		if (node.nodeType === 3) { // Text node
			// Leaf node, extract references from content
			this.extract(node, null, path, syntax);
		}
		else {
			node.normalize();

			syntax = Mavo.Expression.Syntax.create(node) || syntax;

			if (syntax === Mavo.Expression.Syntax.ESCAPE) {
				return;
			}

			if (Mavo.is("group", node)) {
				path = "";
			}

			$$(node.attributes).forEach(attribute => this.extract(node, attribute, path, syntax));
			$$(node.childNodes).forEach((child, i) => this.traverse(child, `${path}/${i}`, syntax));
		}
	},

	static: {
		directives: [],

		PROPERTYCHANGE_THROTTLE: 50
	}
});

if (self.Proxy) {
	Mavo.hooks.add("node-getdata-end", function(env) {
		if (env.options.relative && env.data && typeof env.data === "object") {
			env.data = new Proxy(env.data, {
				get: (data, property, proxy) => {
					// Checking if property is in proxy might add it to the data
					if (property in data || (property in proxy && property in data)) {
						return data[property];
					}

					if (property == "$index") {
						return this.index + 1;
					}

					if (property == this.mavo.id) {
						return data;
					}
				},

				has: (data, property) => {
					if (property in data) {
						return true;
					}

					// Property does not exist, look for it elsewhere

					if (property == "$index" || property == this.mavo.id) {
						return true;
					}

					// First look in ancestors
					var ret = this.walkUp(group => {
						if (property in group.children) {
							return group.children[property];
						};
					});

					if (ret === undefined) {
						// Still not found, look in descendants
						ret = this.find(property);
					}

					if (ret !== undefined) {
						if (Array.isArray(ret)) {
							ret = ret.map(item => item.getData(env.options))
									 .filter(item => item !== null);
						}
						else if (ret instanceof Mavo.Node) {
							ret = ret.getData(env.options);
						}

						data[property] = ret;

						return true;
					}

					return false;
				},

				set: function(data, property, value) {
					throw Error("You can’t set data via expressions.");
				}
			});
		}
	});
}

Mavo.hooks.add("init-tree-before", function() {
	this.expressions = new Mavo.Expressions(this);
});

// Must be on start so that collections don't have a marker yet which messes up paths
Mavo.hooks.add("group-init-start", function() {
	var template = this.template;

	if (template && template.expressions) {
		// We know which expressions we have, don't traverse again
		this.expressions = template.expressions.map(et => new Mavo.Expression.Text({
			template: et,
			group: this,
			mavo: this.mavo
		}));
	}
});

// TODO what about granular rendering?
Mavo.hooks.add("render-end", function() {
	this.expressions.update();
});

})(Bliss, Bliss.$);

// mv-value plugin
Mavo.attributes.push("mv-value");
Mavo.Expressions.directives.push("mv-value");

Mavo.hooks.add("expressiontext-init-start", function() {
	if (this.attribute == "mv-value") {
		this.attribute = Mavo.Primitive.getValueAttribute(this.element);
		this.fallback = this.fallback || Mavo.Primitive.getValue(this.element, {attribute: this.attribute});
		this.expression = this.element.getAttribute("mv-value");

		this.parsed = [new Mavo.Expression(this.expression)];
		this.expression = this.syntax.start + this.expression + this.syntax.end;
	}
});
